/**
 * Cadastro de nova requisição (regra 5 do CONTEXT.md).
 *
 * Tudo — get-or-create do paciente, checagem do número e as N linhas de
 * `requisicao_terapia` — acontece em **uma** transação. Se qualquer linha da
 * lista falhar, a transação inteira volta atrás e nenhum paciente órfão sobra
 * no banco.
 *
 * O get-or-create do paciente mora em `lib/domain/pacientes.ts` desde que o
 * cadastro de encaminhamento passou a precisar dele também — inclusive a
 * explicação de por que a comparação de nome é `lower(nome) = lower($1)`, a
 * mesma expressão do índice `UNIQUE (lower(nome))`.
 *
 * Desde 09/09/2026 a transação também é o lugar onde a regra 15 é aplicada:
 * **não se cria requisição para paciente sem encaminhamento cadastrado**. Ver
 * {@link criarNaTransacao} para o porquê de a checagem morar dentro da
 * transação, e não antes dela.
 */
import { getPrismaClient } from "@/lib/db";
import { OPCOES_DE_TRANSACAO } from "@/lib/db/transacao";
import type { Prisma } from "@/lib/generated/prisma/client";

import { obterOuCriarPaciente } from "./pacientes";
import {
  ERRO_NUMERO_OBRIGATORIO,
  ERRO_PACIENTE_OBRIGATORIO,
  ERRO_QTD_INVALIDA,
  ERRO_SEM_ENCAMINHAMENTO,
  ERRO_SEM_TERAPIA,
  ERRO_TERAPIA_INEXISTENTE,
  ERRO_TERAPIA_OBRIGATORIA,
  ERRO_VALIDADE_INVALIDA,
  erroNumeroDuplicado,
} from "./requisicoes-mensagens";

/**
 * Reexportadas para quem já consome o domínio não precisar saber que as
 * mensagens moram em um módulo à parte (elas moram lá só para o formulário
 * poder importá-las sem arrastar o Prisma para o cliente).
 */
export * from "./requisicoes-mensagens";

/** Uma linha "terapia + quantidade + validade" do formulário. */
export type LinhaDeTerapia = {
  terapiaId: number;
  qtdAutorizada: number;
  /** "AAAA-MM-DD" ou `null`. Opcional — nem toda guia tem validade. */
  validade: string | null;
};

/** O que o formulário manda para a action, já como tipos, não como texto. */
export type EntradaNovaRequisicao = {
  pacienteNome: string;
  numeroRequisicao: string;
  linhas: LinhaDeTerapia[];
};

/** Uma terapia como o `select` do formulário precisa dela. */
export type TerapiaParaEscolha = {
  id: number;
  nome: string;
  codigoTiss: string;
};

export type ResultadoCriacao =
  | {
      ok: true;
      requisicaoId: number;
      numeroRequisicao: string;
      pacienteNome: string;
      /** `false` quando a requisição foi pendurada num paciente já existente. */
      pacienteCriado: boolean;
    }
  | {
      ok: false;
      erro: string;
      /**
       * Índice (base 0) da linha de terapia culpada, quando o erro é de uma
       * linha específica. Serve para o formulário marcar o campo certo em vez
       * de mostrar um erro solto no topo.
       */
      linha?: number;
    };

/**
 * Erro de negócio lançado de dentro da transação.
 *
 * Precisa ser lançado (e não devolvido) porque é o `throw` que faz o Postgres
 * desfazer o que já foi escrito — incluindo um paciente recém-criado. Quem
 * chama converte de volta para `{ ok: false }`.
 */
class ErroDeNegocio extends Error {
  constructor(
    readonly erro: string,
    readonly linha?: number,
  ) {
    super(erro);
    this.name = "ErroDeNegocio";
  }
}

/** Uma data "AAAA-MM-DD" que existe de verdade no calendário. */
function validadeValida(validade: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validade)) {
    return false;
  }

  // `new Date` normaliza silenciosamente ("2026-02-31" vira 03/03). Comparar o
  // ISO de volta é o que rejeita a data que não existe.
  const data = new Date(`${validade}T00:00:00.000Z`);

  return (
    !Number.isNaN(data.getTime()) &&
    data.toISOString().slice(0, 10) === validade
  );
}

/**
 * Validação que não precisa do banco.
 *
 * Roda antes de abrir a transação: não vale gastar conexão com um formulário
 * que já dá para recusar. É a mesma checagem que o cliente faz — o cliente é
 * conveniência, esta aqui é a que vale, porque a action é alcançável por POST
 * direto.
 */
export function validarEntrada(
  entrada: EntradaNovaRequisicao,
): { ok: true } | { ok: false; erro: string; linha?: number } {
  if (!entrada.pacienteNome.trim()) {
    return { ok: false, erro: ERRO_PACIENTE_OBRIGATORIO };
  }

  if (!entrada.numeroRequisicao.trim()) {
    return { ok: false, erro: ERRO_NUMERO_OBRIGATORIO };
  }

  if (entrada.linhas.length === 0) {
    return { ok: false, erro: ERRO_SEM_TERAPIA };
  }

  for (const [indice, linha] of entrada.linhas.entries()) {
    if (!Number.isInteger(linha.terapiaId) || linha.terapiaId <= 0) {
      return { ok: false, erro: ERRO_TERAPIA_OBRIGATORIA, linha: indice };
    }

    // A CHECK `requisicao_terapia_qtd_autorizada_positiva` é o backstop no
    // banco; aqui a rejeição vira mensagem em vez de exceção.
    if (!Number.isInteger(linha.qtdAutorizada) || linha.qtdAutorizada <= 0) {
      return { ok: false, erro: ERRO_QTD_INVALIDA, linha: indice };
    }

    if (linha.validade !== null && !validadeValida(linha.validade)) {
      return { ok: false, erro: ERRO_VALIDADE_INVALIDA, linha: indice };
    }
  }

  return { ok: true };
}

/**
 * A criação em si, já dentro de uma transação.
 *
 * Recebe o cliente da transação (em vez de abrir a própria) pelo mesmo motivo
 * de `excluirGuiaNaTransacao`: é o que deixa o teste de integração rodar tudo
 * dentro de uma transação que sofre rollback.
 *
 * Lança {@link ErroDeNegocio} em vez de devolver `{ ok: false }` — devolver não
 * desfaria o paciente que acabou de ser criado.
 */
async function criarNaTransacao(
  tx: Prisma.TransactionClient,
  entrada: EntradaNovaRequisicao,
): Promise<Extract<ResultadoCriacao, { ok: true }>> {
  const pacienteNome = entrada.pacienteNome.trim();
  const numeroRequisicao = entrada.numeroRequisicao.trim();

  const paciente = await obterOuCriarPaciente(tx, pacienteNome);

  // Regra 15: sem encaminhamento cadastrado não há requisição.
  //
  // A checagem só pode acontecer **aqui dentro**, depois do get-or-create, por
  // dois motivos que se somam. O primeiro é que antes da transação não existe
  // `paciente_id` a consultar: um nome digitado pela primeira vez ainda não é
  // paciente nenhum. O segundo é o que o `throw` faz — um nome novo chega até
  // esta linha já **criado** pelo get-or-create, e devolver `{ ok: false }`
  // educadamente deixaria esse paciente órfão no banco, sem requisição e sem
  // encaminhamento. É o mesmo raciocínio de `ERRO_TERAPIA_INEXISTENTE`, e por
  // isso a mesma forma: lançar, para o Postgres desfazer.
  //
  // A pergunta é de **existência**, não de validade: qualquer linha serve,
  // inclusive uma cujo `data_vencimento` já passou. É por isso que a consulta é
  // à tabela `encaminhamento` e não à view `encaminhamento_status` — a view
  // classifica o vencimento, e classificar não é o que está sendo perguntado.
  const encaminhamento = await tx.encaminhamento.findFirst({
    where: { pacienteId: paciente.id },
    select: { id: true },
  });

  if (!encaminhamento) {
    throw new ErroDeNegocio(ERRO_SEM_ENCAMINHAMENTO);
  }

  // Pré-checagem para o usuário ver uma mensagem em vez de uma exceção. Ela
  // tem uma janela de corrida (outro cadastro pode entrar entre o SELECT e o
  // INSERT); quem fecha a janela de verdade é a unique do banco, tratada em
  // `criarRequisicao`.
  const jaExiste = await tx.requisicao.findFirst({
    where: { pacienteId: paciente.id, numeroRequisicao },
    select: { id: true },
  });

  if (jaExiste) {
    throw new ErroDeNegocio(
      erroNumeroDuplicado(numeroRequisicao, paciente.nome),
    );
  }

  // As terapias são conferidas contra o banco antes do insert. Sem isso um id
  // inventado viraria violação de FK — erro cru de driver, não mensagem.
  const idsPedidos = entrada.linhas.map((linha) => linha.terapiaId);

  const existentes = await tx.terapia.findMany({
    where: { id: { in: idsPedidos } },
    select: { id: true },
  });

  const idsExistentes = new Set(existentes.map((terapia) => terapia.id));
  const indiceRuim = idsPedidos.findIndex((id) => !idsExistentes.has(id));

  if (indiceRuim !== -1) {
    // Chegar aqui com o paciente já criado é exatamente o caso que o rollback
    // precisa cobrir: o `throw` desfaz o paciente junto.
    throw new ErroDeNegocio(ERRO_TERAPIA_INEXISTENTE, indiceRuim);
  }

  const requisicao = await tx.requisicao.create({
    data: {
      numeroRequisicao,
      pacienteId: paciente.id,
      guias: {
        create: entrada.linhas.map((linha) => ({
          terapiaId: linha.terapiaId,
          qtdAutorizada: linha.qtdAutorizada,
          // Coluna DATE: gravamos a meia-noite UTC do dia informado, para o
          // dia gravado não depender do fuso de quem submeteu o formulário.
          validade: linha.validade
            ? new Date(`${linha.validade}T00:00:00.000Z`)
            : null,
        })),
      },
    },
    select: { id: true },
  });

  return {
    ok: true,
    requisicaoId: requisicao.id,
    numeroRequisicao,
    pacienteNome: paciente.nome,
    pacienteCriado: paciente.criado,
  };
}

/** Código do Prisma para violação de unique. */
const VIOLACAO_DE_UNIQUE = "P2002";

/** Nome da unique `(paciente_id, numero_requisicao)` no banco. */
const UNIQUE_NUMERO_POR_PACIENTE =
  "requisicao_paciente_id_numero_requisicao_key";

/** `true` se `erro` é o choque com a unique de número por paciente. */
function ehNumeroDuplicado(erro: unknown): boolean {
  if (typeof erro !== "object" || erro === null) {
    return false;
  }

  const candidato = erro as { code?: unknown; meta?: { target?: unknown } };

  if (candidato.code !== VIOLACAO_DE_UNIQUE) {
    return false;
  }

  // `target` chega como string ou como lista de colunas, dependendo de como o
  // Prisma leu o erro do driver. Serializar cobre as duas formas.
  return JSON.stringify(candidato.meta?.target ?? "").includes(
    UNIQUE_NUMERO_POR_PACIENTE,
  );
}

/**
 * Cria a requisição inteira, abrindo a própria transação.
 *
 * Validação sem banco primeiro; depois a transação. Erro de negócio lançado lá
 * dentro chega aqui já com a transação desfeita, e vira `{ ok: false }`.
 */
export async function criarRequisicao(
  entrada: EntradaNovaRequisicao,
): Promise<ResultadoCriacao> {
  const validacao = validarEntrada(entrada);

  if (!validacao.ok) {
    return { ok: false, erro: validacao.erro, linha: validacao.linha };
  }

  try {
    return await getPrismaClient().$transaction(
      (tx) => criarNaTransacao(tx, entrada),
      OPCOES_DE_TRANSACAO,
    );
  } catch (erro) {
    if (erro instanceof ErroDeNegocio) {
      return { ok: false, erro: erro.erro, linha: erro.linha };
    }

    // Corrida perdida na pré-checagem do número: a unique do banco pegou. A
    // transação já foi desfeita, então nada ficou pela metade.
    if (ehNumeroDuplicado(erro)) {
      return {
        ok: false,
        erro: erroNumeroDuplicado(
          entrada.numeroRequisicao.trim(),
          entrada.pacienteNome.trim(),
        ),
      };
    }

    throw erro;
  }
}

/**
 * Versão de {@link criarRequisicao} que roda numa transação já aberta.
 *
 * Existe para o teste de integração: ele precisa criar de verdade e desfazer
 * tudo no fim. Aqui o erro de negócio vira `{ ok: false }` sem desfazer nada —
 * quem controla o rollback é o chamador.
 *
 * Em produção use {@link criarRequisicao}: é ela que garante a atomicidade.
 */
export async function criarRequisicaoNaTransacao(
  tx: Prisma.TransactionClient,
  entrada: EntradaNovaRequisicao,
): Promise<ResultadoCriacao> {
  const validacao = validarEntrada(entrada);

  if (!validacao.ok) {
    return { ok: false, erro: validacao.erro, linha: validacao.linha };
  }

  try {
    return await criarNaTransacao(tx, entrada);
  } catch (erro) {
    if (erro instanceof ErroDeNegocio) {
      return { ok: false, erro: erro.erro, linha: erro.linha };
    }

    throw erro;
  }
}

/** Terapias disponíveis, em ordem alfabética. */
export async function listarTerapias(): Promise<TerapiaParaEscolha[]> {
  return getPrismaClient().$queryRaw<TerapiaParaEscolha[]>`
    SELECT "id", "nome", "codigo_tiss" AS "codigoTiss"
    FROM "terapia"
    ORDER BY lower("nome"), "id"
  `;
}

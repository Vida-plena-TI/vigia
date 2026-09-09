/**
 * Encaminhamentos médicos: cadastro e listagem.
 *
 * Duas regras derivadas desta tela, e **nenhuma das duas está escrita neste
 * arquivo** — as duas moram no banco, pelo mesmo motivo que o saldo e o
 * `status_alerta` de uma guia moram só na view `requisicao_terapia_saldo`:
 * fórmula derivada replicada em TypeScript vira uma segunda fonte de verdade, e
 * as duas divergem no primeiro ajuste que só uma delas receber.
 *
 * 1. **O encaminhamento vence 180 dias corridos depois da data em que foi
 *    feito.** Vive na coluna gerada `encaminhamento.data_vencimento`
 *    (`(data_encaminhamento + INTERVAL '180 days')::date`, migration
 *    `20260909130000_encaminhamento`). Consequência prática para quem mexer
 *    aqui: o INSERT nunca menciona `data_vencimento` (o Postgres recusaria,
 *    `GENERATED ALWAYS`), e o valor de volta vem do `RETURNING` — não de uma
 *    soma feita em JavaScript. No UPDATE do upsert é a mesma coisa: mudar
 *    `data_encaminhamento` faz o Postgres recalcular o vencimento sozinho.
 *
 * 2. **O status compara meses de calendário, não dias.** Vive na view
 *    `encaminhamento_status` (migration
 *    `20260909140100_view_encaminhamento_status`), que classifica em "Vencido",
 *    "Vence este mês", "A vencer" ou nenhum status. Repare que é uma unidade de
 *    medida diferente da do alerta de validade da guia, que conta dias: aqui um
 *    vencimento no dia 01 e outro no dia 31 do mesmo mês dizem a mesma coisa.
 *
 * A terceira regra é de unicidade, e essa também é do banco: **um paciente tem
 * no máximo um encaminhamento**. Cadastrar outro substitui o anterior, via
 * `INSERT ... ON CONFLICT ("paciente_id") DO UPDATE` — arbitrado pelo índice
 * único criado em `20260909140000_encaminhamento_unico_por_paciente`.
 *
 * As duas colunas `DATE` viajam como texto `"AAAA-MM-DD"` até a tela, como
 * `validade` e `data_atendimento`: virar `Date` faria o dia exibido depender do
 * fuso de quem renderiza, e a data apareceria um dia deslocada.
 */
import { getPrismaClient } from "@/lib/db";
import { OPCOES_DE_TRANSACAO } from "@/lib/db/transacao";
import type { Prisma } from "@/lib/generated/prisma/client";

import {
  ERRO_DATA_INVALIDA,
  ERRO_DATA_OBRIGATORIA,
  ERRO_PACIENTE_OBRIGATORIO,
} from "./encaminhamentos-mensagens";
import { obterOuCriarPaciente } from "./pacientes";

/**
 * Reexportadas para quem consome o domínio não precisar saber que as mensagens
 * moram em um módulo à parte (elas moram lá só para o formulário poder
 * importá-las sem arrastar o Prisma para o cliente).
 */
export * from "./encaminhamentos-mensagens";

/**
 * O status de vencimento, como a view `encaminhamento_status` o produz.
 *
 * O quarto caso da classificação — vencimento a dois ou mais meses de
 * distância — não tem rótulo: é `null`, e a tela o mostra sem marcação nenhuma.
 * Ausência de status é uma resposta, não falta de dado.
 */
export type StatusEncaminhamento = "Vencido" | "Vence este mês" | "A vencer";

/**
 * Ordem de exibição do resumo, do mais urgente para o menos.
 *
 * É a mesma ideia de `STATUS_EM_ORDEM_DE_URGENCIA` no painel; a diferença é que
 * lá a ordem também resolve precedência (uma linha do painel resume várias
 * guias), e aqui não há o que resolver — cada encaminhamento tem um status só.
 */
export const STATUS_DE_ENCAMINHAMENTO_EM_ORDEM: readonly StatusEncaminhamento[] =
  ["Vencido", "Vence este mês", "A vencer"];

/** Uma linha da listagem — três colunas de dado mais o status calculado. */
export type EncaminhamentoNaLista = {
  id: number;
  pacienteNome: string;
  /** "AAAA-MM-DD". */
  dataEncaminhamento: string;
  /** "AAAA-MM-DD", calculada pelo banco. */
  dataVencimento: string;
  /**
   * Vem pronto da view `encaminhamento_status`, comparando o **mês** do
   * vencimento com o mês atual do banco.
   *
   * Não é decidido em JavaScript por dois motivos que se somam: a comparação de
   * meses tem uma única fonte de verdade (a view), e o "mês atual" é o do
   * `CURRENT_DATE` do banco — o relógio do Node (UTC na Vercel) discordaria
   * dele à noite no horário de Brasília, e na virada do mês essa diferença
   * trocaria o status de todas as linhas de uma vez.
   */
  statusEncaminhamento: StatusEncaminhamento | null;
};

/** Contagem por status, para o resumo do topo da tela. */
export type ResumoDeEncaminhamentos = Record<StatusEncaminhamento, number>;

/** O que o formulário manda para a action, já como tipos, não como texto. */
export type EntradaNovoEncaminhamento = {
  pacienteNome: string;
  /** "AAAA-MM-DD". */
  dataEncaminhamento: string;
};

export type ResultadoGravacao =
  | {
      ok: true;
      id: number;
      pacienteNome: string;
      dataEncaminhamento: string;
      /** Vem do `RETURNING` da coluna gerada — nunca de cálculo em TypeScript. */
      dataVencimento: string;
      /** `false` quando o encaminhamento foi pendurado num paciente já existente. */
      pacienteCriado: boolean;
      /**
       * `true` quando o paciente já tinha um encaminhamento e este o substituiu.
       *
       * É o que separa "Encaminhamento atualizado para X" de "Encaminhamento
       * cadastrado para X" na confirmação — ver `mensagemDeCadastro`.
       */
      substituiuAnterior: boolean;
    }
  | { ok: false; erro: string };

/** Uma data "AAAA-MM-DD" que existe de verdade no calendário. */
function dataValida(data: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return false;
  }

  // `new Date` normaliza silenciosamente ("2026-02-31" vira 03/03). Comparar o
  // ISO de volta é o que rejeita a data que não existe.
  const convertida = new Date(`${data}T00:00:00.000Z`);

  return (
    !Number.isNaN(convertida.getTime()) &&
    convertida.toISOString().slice(0, 10) === data
  );
}

/**
 * Validação que não precisa do banco.
 *
 * É a mesma checagem que o formulário faz — o cliente é conveniência, esta é a
 * que vale, porque a Server Action é alcançável por POST direto.
 */
export function validarEntrada(
  entrada: EntradaNovoEncaminhamento,
): { ok: true } | { ok: false; erro: string } {
  if (!entrada.pacienteNome.trim()) {
    return { ok: false, erro: ERRO_PACIENTE_OBRIGATORIO };
  }

  const data = entrada.dataEncaminhamento.trim();

  if (!data) {
    return { ok: false, erro: ERRO_DATA_OBRIGATORIA };
  }

  if (!dataValida(data)) {
    return { ok: false, erro: ERRO_DATA_INVALIDA };
  }

  return { ok: true };
}

/** O que o `RETURNING` do upsert devolve, já com as datas como texto. */
type LinhaGravada = {
  id: number;
  dataEncaminhamento: string;
  dataVencimento: string;
};

/**
 * A gravação em si, já dentro de uma transação.
 *
 * Recebe o cliente da transação (em vez de abrir a própria) pelo mesmo motivo
 * de `criarRequisicaoNaTransacao` e `excluirGuiaNaTransacao`: é o que deixa o
 * teste de integração gravar de verdade e desfazer tudo no fim.
 *
 * O paciente e o encaminhamento precisam nascer juntos — daí a transação. Um
 * `INSERT` que falhasse depois do get-or-create deixaria um paciente órfão, do
 * mesmo jeito que a criação de requisição evita.
 */
async function gravarNaTransacao(
  tx: Prisma.TransactionClient,
  entrada: EntradaNovoEncaminhamento,
): Promise<Extract<ResultadoGravacao, { ok: true }>> {
  const pacienteNome = entrada.pacienteNome.trim();
  const dataEncaminhamento = entrada.dataEncaminhamento.trim();

  const paciente = await obterOuCriarPaciente(tx, pacienteNome);

  // Olhar antes de gravar é o que permite dizer *qual* dos dois caminhos
  // aconteceu — mesma coisa que `scripts/seed-terapias.ts` faz para relatar
  // "criada" ou "já existente" no upsert do catálogo. O upsert sozinho grava
  // certo, mas não conta qual ramo tomou.
  //
  // O `FOR UPDATE` trava a linha existente: dois cadastros simultâneos para o
  // mesmo paciente passam a ser sequenciais, e o segundo enxerga o resultado do
  // primeiro em vez de os dois se acharem o primeiro. Quando ainda não existe
  // linha não há o que travar, e nessa corrida (dois cadastros do *primeiro*
  // encaminhamento de um mesmo paciente novo) os dois podem dizer "cadastrado"
  // — o `ON CONFLICT` continua deixando uma linha só, com a data do último; só
  // a palavra da confirmação fica otimista.
  const anteriores = await tx.$queryRaw<{ id: number }[]>`
    SELECT "id" FROM "encaminhamento" WHERE "paciente_id" = ${paciente.id} FOR UPDATE
  `;

  // `data_vencimento` não aparece na lista de colunas do INSERT nem no SET do
  // UPDATE de propósito: ela é `GENERATED ALWAYS`, e o Postgres recusa qualquer
  // tentativa de gravar valor nela — inclusive no ramo de update, onde ele a
  // recalcula sozinho a partir da `data_encaminhamento` nova. O `RETURNING` é
  // como o valor calculado volta para a tela.
  //
  // O `ON CONFLICT ("paciente_id")` é arbitrado pelo índice único
  // `encaminhamento_paciente_id_key`. Sem esse índice o Postgres nem aceitaria
  // o comando — a regra "um encaminhamento por paciente" e o upsert são a mesma
  // peça vista de dois lados.
  const [linha] = await tx.$queryRaw<LinhaGravada[]>`
    INSERT INTO "encaminhamento" ("paciente_id", "data_encaminhamento")
    VALUES (${paciente.id}, ${dataEncaminhamento}::date)
    ON CONFLICT ("paciente_id") DO UPDATE
      SET "data_encaminhamento" = EXCLUDED."data_encaminhamento"
    RETURNING
      "id",
      "data_encaminhamento"::text AS "dataEncaminhamento",
      "data_vencimento"::text     AS "dataVencimento"
  `;

  return {
    ok: true,
    id: linha.id,
    pacienteNome: paciente.nome,
    dataEncaminhamento: linha.dataEncaminhamento,
    dataVencimento: linha.dataVencimento,
    pacienteCriado: paciente.criado,
    substituiuAnterior: anteriores.length > 0,
  };
}

/**
 * Grava o encaminhamento inteiro, abrindo a própria transação.
 *
 * Validação sem banco primeiro; depois a transação. É esta a função que a
 * Server Action chama.
 *
 * "Registrar" e não "criar": para um paciente que já tinha encaminhamento, ela
 * **substitui** o anterior em vez de acrescentar uma segunda linha.
 */
export async function registrarEncaminhamento(
  entrada: EntradaNovoEncaminhamento,
): Promise<ResultadoGravacao> {
  const validacao = validarEntrada(entrada);

  if (!validacao.ok) {
    return validacao;
  }

  return getPrismaClient().$transaction(
    (tx) => gravarNaTransacao(tx, entrada),
    OPCOES_DE_TRANSACAO,
  );
}

/**
 * Versão de {@link registrarEncaminhamento} que roda numa transação já aberta.
 *
 * Existe para o teste de integração, que precisa gravar de verdade e desfazer
 * tudo no fim. Em produção use {@link registrarEncaminhamento}.
 */
export async function registrarEncaminhamentoNaTransacao(
  tx: Prisma.TransactionClient,
  entrada: EntradaNovoEncaminhamento,
): Promise<ResultadoGravacao> {
  const validacao = validarEntrada(entrada);

  if (!validacao.ok) {
    return validacao;
  }

  return gravarNaTransacao(tx, entrada);
}

/** Linha crua da view, antes da validação do status. */
type LinhaDaListagem = Omit<EncaminhamentoNaLista, "statusEncaminhamento"> & {
  statusEncaminhamento: string | null;
};

/**
 * Aceita apenas o que a view pode ter produzido.
 *
 * Mesmo guarda-corpo de `comoStatusAlerta` em `guias.ts`: se a view ganhar um
 * rótulo novo e este código não souber dele, é melhor estourar aqui do que
 * deixar a linha passar sem selo, como se estivesse longe de vencer.
 */
function comoStatusEncaminhamento(
  valor: string | null,
): StatusEncaminhamento | null {
  if (valor === null) {
    return null;
  }

  if (
    valor === "Vencido" ||
    valor === "Vence este mês" ||
    valor === "A vencer"
  ) {
    return valor;
  }

  throw new Error(
    `status_encaminhamento desconhecido vindo da view: ${JSON.stringify(valor)}`,
  );
}

/**
 * Todos os encaminhamentos, do mais recente para o mais antigo.
 *
 * Lê da view `encaminhamento_status`, não da tabela: o status já vem
 * classificado de lá, como o painel lê `requisicao_terapia_saldo` em vez de
 * `requisicao_terapia`. A view carrega as colunas da tabela junto, então não há
 * junção com `encaminhamento` a fazer — só com `paciente`, pelo nome.
 *
 * A ordem é `data_encaminhamento DESC, id DESC` porque o uso esperado desta
 * tela é cadastrar vários em sequência: o registro recém-gravado precisa
 * aparecer no topo da lista, logo abaixo do formulário, sem rolagem. Ordenar
 * por nome (como o painel faz) esconderia no meio da lista a confirmação do que
 * acabou de ser digitado.
 */
export async function listarEncaminhamentos(): Promise<
  EncaminhamentoNaLista[]
> {
  const linhas = await getPrismaClient().$queryRaw<LinhaDaListagem[]>`
    SELECT
      s."id"                        AS "id",
      p."nome"                      AS "pacienteNome",
      s."data_encaminhamento"::text AS "dataEncaminhamento",
      s."data_vencimento"::text     AS "dataVencimento",
      s."status_encaminhamento"     AS "statusEncaminhamento"
    FROM "encaminhamento_status" s
    JOIN "paciente" p ON p."id" = s."paciente_id"
    ORDER BY s."data_encaminhamento" DESC, s."id" DESC
  `;

  return linhas.map((linha) => ({
    ...linha,
    statusEncaminhamento: comoStatusEncaminhamento(linha.statusEncaminhamento),
  }));
}

/**
 * Contagem por status, para o resumo do topo da tela.
 *
 * Conta em memória a lista que a página já carregou, como `contarPorStatus` faz
 * no painel: é contagem, não classificação — quem classifica é a view, e uma
 * segunda consulta só para somar três números pagaria uma ida ao banco a mais
 * pelo mesmo resultado.
 *
 * Encaminhamento sem status (vencimento a dois ou mais meses) não entra em
 * nenhum dos três contadores, do mesmo jeito que não ganha selo na tabela.
 */
export function contarPorStatusDeEncaminhamento(
  encaminhamentos: readonly EncaminhamentoNaLista[],
): ResumoDeEncaminhamentos {
  const resumo: ResumoDeEncaminhamentos = {
    Vencido: 0,
    "Vence este mês": 0,
    "A vencer": 0,
  };

  for (const encaminhamento of encaminhamentos) {
    if (encaminhamento.statusEncaminhamento !== null) {
      resumo[encaminhamento.statusEncaminhamento] += 1;
    }
  }

  return resumo;
}

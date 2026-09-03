/**
 * Lançamento de atendimento em lote (regras 6 e 7 do CONTEXT.md).
 *
 * O ponto delicado deste módulo é a corrida de saldo: duas pessoas lançando ao
 * mesmo tempo contra a mesma guia não podem consumir o mesmo crédito duas
 * vezes. A defesa é a sequência de {@link lancarLoteNaTransacao}:
 *
 *   1. `SELECT ... FOR UPDATE` nas linhas de `requisicao_terapia` envolvidas,
 *      **em ordem crescente de id**;
 *   2. só depois a leitura do saldo na view `requisicao_terapia_saldo`;
 *   3. o INSERT dos atendimentos.
 *
 * A ordem 1 -> 2 é o que faz a coisa funcionar, e depende de um detalhe do
 * Postgres: em READ COMMITTED (o padrão) **cada comando** tira um snapshot
 * novo. Enquanto a transação A não commita, o `FOR UPDATE` de B fica bloqueado;
 * quando A commita e B destrava, o `SELECT` da view em B é um comando novo, com
 * snapshot novo, e enxerga os atendimentos que A acabou de gravar. Ler o saldo
 * antes de travar (ou na mesma consulta) devolveria o saldo velho, e as duas
 * transações aprovariam o mesmo crédito.
 *
 * A view não pode ser travada diretamente (`FOR UPDATE` não se aplica a view
 * com agregação), e inserir em `atendimento` não toca em `requisicao_terapia` —
 * então o lock nessa tabela funciona como ponto de encontro combinado: vale
 * porque *todo* caminho que mexe no saldo passa por ele.
 * `excluirGuiaNaTransacao` trava as mesmas linhas, pelo mesmo motivo.
 *
 * A ordenação por id evita deadlock: dois lotes que compartilham as guias 7 e 9
 * pedem os locks na mesma sequência (7 depois 9), então um espera o outro em
 * vez de se travarem em cruz.
 */
import { getPrismaClient } from "@/lib/db";
import { OPCOES_DE_TRANSACAO } from "@/lib/db/transacao";
import type { Prisma } from "@/lib/generated/prisma/client";

import type { StatusAlerta } from "./saldo";
import {
  ERRO_ATENDIMENTO_ID_INVALIDO,
  ERRO_ATENDIMENTO_INEXISTENTE,
  ERRO_CREDITOS_EDICAO_INVALIDOS,
  ERRO_CREDITOS_INVALIDOS,
  ERRO_DATA_INVALIDA,
  ERRO_GUIA_DE_OUTRO_PACIENTE,
  ERRO_GUIA_DUPLICADA,
  ERRO_GUIA_INEXISTENTE,
  ERRO_GUIA_INVALIDA,
  ERRO_PACIENTE_OBRIGATORIO,
  ERRO_SEM_SELECAO,
  erroEdicaoUltrapassaAutorizado,
  erroSaldoInsuficiente,
} from "./atendimentos-mensagens";

/**
 * Reexportadas para quem consome o domínio não precisar saber que as mensagens
 * moram em um módulo à parte (elas moram lá só para o formulário poder
 * importá-las sem arrastar o Prisma para o cliente).
 */
export * from "./atendimentos-mensagens";

/** Um paciente no `select` da tela de lançamento. */
export type PacienteParaEscolha = {
  id: number;
  nome: string;
};

/** Uma guia com saldo, como a tela de lançamento precisa dela. */
export type GuiaDisponivel = {
  id: number;
  terapiaNome: string;
  codigoTiss: string;
  numeroRequisicao: string;
  qtdAutorizada: number;
  qtdUtilizada: number;
  saldoRestante: number;
  /**
   * "AAAA-MM-DD" ou `null`. Viaja como texto do banco até a tela pelo mesmo
   * motivo de `GuiaDoDashboard.validade`: `DATE` é dia civil, e passar por
   * `Date` faria o dia exibido depender do fuso de quem renderiza.
   */
  validade: string | null;
  statusAlerta: StatusAlerta;
};

/** Atendimento lançado hoje, como a página `/atendimentos/hoje` precisa. */
export type AtendimentoDeHoje = {
  id: number;
  pacienteNome: string;
  terapiaNome: string;
  creditosConsumidos: number;
  observacao: string | null;
};

/** Uma terapia marcada no formulário, com quantos créditos ela consome. */
export type ItemDoLote = {
  requisicaoTerapiaId: number;
  creditosConsumidos: number;
};

/** O lote inteiro, já como tipos, não como texto de formulário. */
export type EntradaDeLote = {
  pacienteId: number;
  /** "AAAA-MM-DD". */
  dataAtendimento: string;
  observacao: string | null;
  itens: ItemDoLote[];
};

export type ResultadoDoLote =
  | {
      ok: true;
      /** Quantos atendimentos foram gravados (= terapias marcadas). */
      totalDeAtendimentos: number;
      /** Soma dos créditos consumidos no lote. */
      totalDeCreditos: number;
    }
  | {
      ok: false;
      erro: string;
      /**
       * Índice (base 0) do item culpado dentro de `entrada.itens`, quando o
       * erro é de um item específico. Serve para o formulário marcar a linha
       * certa em vez de mostrar um erro solto no topo.
       */
      item?: number;
    };

/** Dados editáveis de um atendimento. */
export type EntradaDeEdicaoDeAtendimento = {
  atendimentoId: number;
  /** "AAAA-MM-DD". */
  dataAtendimento: string;
  creditosConsumidos: number;
  observacao: string | null;
};

export type ResultadoEdicaoDeAtendimento =
  | {
      ok: true;
      requisicaoTerapiaId: number;
      totalUtilizado: number;
    }
  | { ok: false; erro: string };

export type ResultadoExclusaoDeAtendimento =
  | { ok: true }
  | { ok: false; erro: string };

/** Linha crua da consulta de guias, antes da validação do status. */
type LinhaDeGuia = Omit<GuiaDisponivel, "statusAlerta"> & {
  statusAlerta: string;
};

/**
 * Aceita apenas o que a view pode ter produzido.
 *
 * Mesma checagem de `lib/domain/guias.ts`: se a view ganhar um status novo e
 * este código não souber dele, é melhor estourar do que decidir errado.
 */
function comoStatusAlerta(valor: string): StatusAlerta {
  if (valor === "Regular" || valor === "Renovar" || valor === "Esgotada") {
    return valor;
  }

  throw new Error(
    `status_alerta inesperado vindo da view: ${JSON.stringify(valor)}`,
  );
}

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
 * Pacientes que têm pelo menos uma guia com saldo.
 *
 * Quem não tem nenhuma guia lançável não aparece no `select`: escolhê-lo só
 * levaria a uma lista de terapias vazia. O `EXISTS` sobre a view usa a mesma
 * condição da regra 6 (`saldo_restante > 0`) que
 * {@link listarGuiasDisponiveisDoPaciente} aplica depois — as duas consultas
 * precisam concordar sobre o que é "lançável".
 */
export async function listarPacientesComGuiasDisponiveis(): Promise<
  PacienteParaEscolha[]
> {
  return getPrismaClient().$queryRaw<PacienteParaEscolha[]>`
    SELECT p."id", p."nome"
    FROM "paciente" p
    WHERE EXISTS (
      SELECT 1
      FROM "requisicao" r
      JOIN "requisicao_terapia_saldo" s ON s."requisicao_id" = r."id"
      WHERE r."paciente_id" = p."id"
        AND s."saldo_restante" > 0
    )
    ORDER BY lower(p."nome"), p."id"
  `;
}

/**
 * Guias com saldo de um paciente (regra 6 do CONTEXT.md).
 *
 * O saldo vem da view, nunca de fórmula em TypeScript. O filtro
 * `saldo_restante > 0` é o que mantém fora da tela a guia esgotada — e ele é
 * refeito dentro da transação de lançamento, porque esta lista é só o que o
 * usuário viu quando escolheu o paciente, não uma garantia.
 */
export async function listarGuiasDisponiveisDoPaciente(
  pacienteId: number,
): Promise<GuiaDisponivel[]> {
  if (!Number.isInteger(pacienteId) || pacienteId <= 0) {
    return [];
  }

  const linhas = await getPrismaClient().$queryRaw<LinhaDeGuia[]>`
    SELECT
      s."id"                AS "id",
      t."nome"              AS "terapiaNome",
      t."codigo_tiss"       AS "codigoTiss",
      r."numero_requisicao" AS "numeroRequisicao",
      s."qtd_autorizada"    AS "qtdAutorizada",
      s."qtd_utilizada"     AS "qtdUtilizada",
      s."saldo_restante"    AS "saldoRestante",
      s."validade"::text    AS "validade",
      s."status_alerta"     AS "statusAlerta"
    FROM "requisicao_terapia_saldo" s
    JOIN "requisicao" r ON r."id" = s."requisicao_id"
    JOIN "terapia"    t ON t."id" = s."terapia_id"
    WHERE r."paciente_id" = ${pacienteId}
      AND s."saldo_restante" > 0
    ORDER BY lower(t."nome"), s."id"
  `;

  return linhas.map((linha) => ({
    ...linha,
    statusAlerta: comoStatusAlerta(linha.statusAlerta),
  }));
}

/**
 * Atendimentos lançados na data de hoje segundo o banco.
 *
 * Usa `CURRENT_DATE` pelo mesmo motivo de {@link dataDeHoje}: é o relógio do
 * Postgres que também orienta a view de saldo/status. A página não recebe data
 * do cliente e não tem filtros por enquanto.
 */
export async function listarAtendimentosDeHoje(): Promise<
  AtendimentoDeHoje[]
> {
  return getPrismaClient().$queryRaw<AtendimentoDeHoje[]>`
    SELECT
      a."id"                  AS "id",
      p."nome"                AS "pacienteNome",
      t."nome"                AS "terapiaNome",
      a."creditos_consumidos" AS "creditosConsumidos",
      a."observacao"          AS "observacao"
    FROM "atendimento" a
    JOIN "requisicao_terapia" rt ON rt."id" = a."requisicao_terapia_id"
    JOIN "requisicao"         r  ON r."id" = rt."requisicao_id"
    JOIN "paciente"           p  ON p."id" = r."paciente_id"
    JOIN "terapia"            t  ON t."id" = rt."terapia_id"
    WHERE a."data_atendimento" = CURRENT_DATE
    ORDER BY lower(p."nome"), p."id", lower(t."nome"), t."id", a."id"
  `;
}

/**
 * Validação que não precisa do banco (itens 1 a 3 da regra 7).
 *
 * Roda antes de abrir a transação: não vale gastar conexão com um lote que já
 * dá para recusar. É a mesma checagem que o formulário faz — o formulário é
 * conveniência, esta aqui é a que vale, porque a Server Action é alcançável por
 * POST direto.
 */
export function validarLote(
  entrada: EntradaDeLote,
): { ok: true } | { ok: false; erro: string; item?: number } {
  if (!Number.isInteger(entrada.pacienteId) || entrada.pacienteId <= 0) {
    return { ok: false, erro: ERRO_PACIENTE_OBRIGATORIO };
  }

  if (!dataValida(entrada.dataAtendimento)) {
    return { ok: false, erro: ERRO_DATA_INVALIDA };
  }

  if (entrada.itens.length === 0) {
    return { ok: false, erro: ERRO_SEM_SELECAO };
  }

  const jaVistos = new Set<number>();

  for (const [indice, item] of entrada.itens.entries()) {
    if (
      !Number.isInteger(item.requisicaoTerapiaId) ||
      item.requisicaoTerapiaId <= 0
    ) {
      return { ok: false, erro: ERRO_GUIA_INVALIDA, item: indice };
    }

    // A UI mostra uma linha por guia, então só um POST montado à mão chega
    // aqui com repetição. Recusar é obrigatório mesmo assim: dois itens da
    // mesma guia passariam pela checagem de saldo com o mesmo saldo de
    // partida, e juntos poderiam estourar a autorização.
    if (jaVistos.has(item.requisicaoTerapiaId)) {
      return { ok: false, erro: ERRO_GUIA_DUPLICADA, item: indice };
    }

    jaVistos.add(item.requisicaoTerapiaId);

    // Diferente da edição de atendimento (regra 8), que aceita 0: aqui lançar
    // zero crédito não significa nada, é linha marcada por engano.
    if (
      !Number.isInteger(item.creditosConsumidos) ||
      item.creditosConsumidos <= 0
    ) {
      return { ok: false, erro: ERRO_CREDITOS_INVALIDOS, item: indice };
    }
  }

  return { ok: true };
}

/**
 * Validação sem banco para edição de atendimento (regra 8 do CONTEXT.md).
 *
 * Diferente do lançamento, a edição aceita `creditos_consumidos = 0`. O que
 * continua proibido é crédito negativo, fracionário ou não inteiro.
 */
export function validarEdicaoDeAtendimento(
  entrada: EntradaDeEdicaoDeAtendimento,
): { ok: true } | { ok: false; erro: string } {
  if (!Number.isInteger(entrada.atendimentoId) || entrada.atendimentoId <= 0) {
    return { ok: false, erro: ERRO_ATENDIMENTO_ID_INVALIDO };
  }

  if (!dataValida(entrada.dataAtendimento)) {
    return { ok: false, erro: ERRO_DATA_INVALIDA };
  }

  if (
    !Number.isInteger(entrada.creditosConsumidos) ||
    entrada.creditosConsumidos < 0
  ) {
    return { ok: false, erro: ERRO_CREDITOS_EDICAO_INVALIDOS };
  }

  return { ok: true };
}

/** Saldo e identidade de uma guia, como a transação precisa vê-los. */
type GuiaTravada = {
  id: number;
  pacienteId: number;
  terapiaNome: string;
  saldoRestante: number;
};

/**
 * O lançamento em si, já dentro de uma transação.
 *
 * Recebe o cliente da transação (em vez de abrir a própria) pelo mesmo motivo
 * de `excluirGuiaNaTransacao` e `criarRequisicaoNaTransacao`: é o que deixa o
 * teste de integração rodar tudo dentro de uma transação que sofre rollback.
 *
 * Pode devolver `{ ok: false }` sem medo (ao contrário de
 * `criarRequisicaoNaTransacao`, que precisa lançar): até o INSERT final nada
 * foi escrito, então não há o que desfazer. Só os locks ficam de pé — e eles
 * caem no fim da transação de qualquer jeito.
 *
 * @see lancarLote para a versão que abre a transação sozinha.
 */
export async function lancarLoteNaTransacao(
  tx: Prisma.TransactionClient,
  entrada: EntradaDeLote,
): Promise<ResultadoDoLote> {
  const validacao = validarLote(entrada);

  if (!validacao.ok) {
    return { ok: false, erro: validacao.erro, item: validacao.item };
  }

  const ids = entrada.itens.map((item) => item.requisicaoTerapiaId);

  // Passo 1: travar as guias. O `ORDER BY "id"` não é cosmético — no plano do
  // Postgres o nó `LockRows` fica acima do `Sort`, então as linhas são travadas
  // na ordem em que saem ordenadas. É isso que dá a ordem determinística que
  // evita deadlock entre dois lotes com guias em comum.
  //
  // A view fica de fora daqui de propósito: `FOR UPDATE` não se aplica a uma
  // view com agregação, e é a leitura seguinte (comando novo, snapshot novo)
  // que precisa enxergar o que a transação concorrente commitou.
  const travadas = await tx.$queryRaw<{ id: number }[]>`
    SELECT "id"
    FROM "requisicao_terapia"
    WHERE "id" = ANY(${ids}::int[])
    ORDER BY "id"
    FOR UPDATE
  `;

  if (travadas.length !== ids.length) {
    const encontradas = new Set(travadas.map((guia) => guia.id));
    const indiceRuim = ids.findIndex((id) => !encontradas.has(id));

    return {
      ok: false,
      erro: ERRO_GUIA_INEXISTENTE,
      item: indiceRuim === -1 ? undefined : indiceRuim,
    };
  }

  // Passo 2: só agora o saldo, e sempre da view.
  const guias = await tx.$queryRaw<GuiaTravada[]>`
    SELECT
      s."id"             AS "id",
      r."paciente_id"    AS "pacienteId",
      t."nome"           AS "terapiaNome",
      s."saldo_restante" AS "saldoRestante"
    FROM "requisicao_terapia_saldo" s
    JOIN "requisicao" r ON r."id" = s."requisicao_id"
    JOIN "terapia"    t ON t."id" = s."terapia_id"
    WHERE s."id" = ANY(${ids}::int[])
  `;

  const porId = new Map(guias.map((guia) => [guia.id, guia]));

  for (const [indice, item] of entrada.itens.entries()) {
    const guia = porId.get(item.requisicaoTerapiaId);

    if (!guia) {
      return { ok: false, erro: ERRO_GUIA_INEXISTENTE, item: indice };
    }

    // O formulário é por paciente; uma guia de outro paciente só chega aqui
    // vinda de um POST montado à mão. Recusar mantém o atendimento pendurado
    // em quem o lote diz que é.
    if (guia.pacienteId !== entrada.pacienteId) {
      return { ok: false, erro: ERRO_GUIA_DE_OUTRO_PACIENTE, item: indice };
    }

    // Cobre os dois casos da regra 7: saldo já esgotado (`saldoRestante <= 0`)
    // e pedido acima do disponível.
    if (item.creditosConsumidos > guia.saldoRestante) {
      return {
        ok: false,
        erro: erroSaldoInsuficiente(
          guia.terapiaNome,
          guia.saldoRestante,
          item.creditosConsumidos,
        ),
        item: indice,
      };
    }
  }

  const observacao = entrada.observacao?.trim() || null;

  // Passo 3: o lote inteiro de uma vez. Se qualquer coisa falhar aqui, a
  // transação leva tudo junto — não existe "meio lote".
  await tx.atendimento.createMany({
    data: entrada.itens.map((item) => ({
      requisicaoTerapiaId: item.requisicaoTerapiaId,
      // Coluna DATE: gravamos a meia-noite UTC do dia informado, para o dia
      // gravado não depender do fuso de quem submeteu o formulário.
      dataAtendimento: new Date(`${entrada.dataAtendimento}T00:00:00.000Z`),
      creditosConsumidos: item.creditosConsumidos,
      observacao,
    })),
  });

  return {
    ok: true,
    totalDeAtendimentos: entrada.itens.length,
    totalDeCreditos: entrada.itens.reduce(
      (soma, item) => soma + item.creditosConsumidos,
      0,
    ),
  };
}

/**
 * {@link lancarLoteNaTransacao} abrindo a própria transação.
 *
 * A validação sem banco roda aqui também, antes de abrir a transação: não vale
 * gastar uma conexão (e segurar locks) por causa de um lote que já dá para
 * recusar de cara.
 */
export async function lancarLote(
  entrada: EntradaDeLote,
): Promise<ResultadoDoLote> {
  const validacao = validarLote(entrada);

  if (!validacao.ok) {
    return { ok: false, erro: validacao.erro, item: validacao.item };
  }

  return getPrismaClient().$transaction(
    (tx) => lancarLoteNaTransacao(tx, entrada),
    OPCOES_DE_TRANSACAO,
  );
}

/** A guia travada para uma edição de atendimento. */
type GuiaTravadaParaEdicao = {
  requisicaoTerapiaId: number;
  qtdAutorizada: number;
};

/**
 * Edita um atendimento dentro de uma transação.
 *
 * A trava é a mesma linha de `requisicao_terapia` usada pelo lançamento e pela
 * exclusão de guia. A sequência importa pelo mesmo motivo da regra 7:
 *
 *   1. encontrar o atendimento e travar sua guia com `FOR UPDATE`;
 *   2. somar os outros atendimentos da guia em um comando posterior;
 *   3. recusar se `outros + novos créditos` passar de `qtd_autorizada`;
 *   4. atualizar o atendimento.
 *
 * Assim, duas edições simultâneas na mesma guia não decidem com o mesmo saldo
 * antigo: a segunda espera a primeira commitar e depois recalcula.
 */
export async function editarAtendimentoNaTransacao(
  tx: Prisma.TransactionClient,
  entrada: EntradaDeEdicaoDeAtendimento,
): Promise<ResultadoEdicaoDeAtendimento> {
  const validacao = validarEdicaoDeAtendimento(entrada);

  if (!validacao.ok) {
    return validacao;
  }

  const travadas = await tx.$queryRaw<GuiaTravadaParaEdicao[]>`
    SELECT
      rt."id"             AS "requisicaoTerapiaId",
      rt."qtd_autorizada" AS "qtdAutorizada"
    FROM "atendimento" a
    JOIN "requisicao_terapia" rt ON rt."id" = a."requisicao_terapia_id"
    WHERE a."id" = ${entrada.atendimentoId}
    FOR UPDATE OF rt
  `;

  if (travadas.length === 0) {
    return { ok: false, erro: ERRO_ATENDIMENTO_INEXISTENTE };
  }

  const guia = travadas[0];

  const [soma] = await tx.$queryRaw<{
    creditosDosOutrosAtendimentos: number;
  }[]>`
    SELECT COALESCE(SUM("creditos_consumidos"), 0)::int AS "creditosDosOutrosAtendimentos"
    FROM "atendimento"
    WHERE "requisicao_terapia_id" = ${guia.requisicaoTerapiaId}
      AND "id" <> ${entrada.atendimentoId}
  `;

  const creditosDosOutrosAtendimentos =
    soma?.creditosDosOutrosAtendimentos ?? 0;
  const totalUtilizado =
    creditosDosOutrosAtendimentos + entrada.creditosConsumidos;

  if (totalUtilizado > guia.qtdAutorizada) {
    return {
      ok: false,
      erro: erroEdicaoUltrapassaAutorizado(
        guia.qtdAutorizada,
        creditosDosOutrosAtendimentos,
        entrada.creditosConsumidos,
      ),
    };
  }

  const atualizacao = await tx.atendimento.updateMany({
    where: { id: entrada.atendimentoId },
    data: {
      dataAtendimento: new Date(`${entrada.dataAtendimento}T00:00:00.000Z`),
      creditosConsumidos: entrada.creditosConsumidos,
      observacao: entrada.observacao?.trim() || null,
    },
  });

  if (atualizacao.count === 0) {
    return { ok: false, erro: ERRO_ATENDIMENTO_INEXISTENTE };
  }

  return {
    ok: true,
    requisicaoTerapiaId: guia.requisicaoTerapiaId,
    totalUtilizado,
  };
}

/** {@link editarAtendimentoNaTransacao} abrindo a própria transação. */
export async function editarAtendimentoPeloId(
  entrada: EntradaDeEdicaoDeAtendimento,
): Promise<ResultadoEdicaoDeAtendimento> {
  const validacao = validarEdicaoDeAtendimento(entrada);

  if (!validacao.ok) {
    return validacao;
  }

  return getPrismaClient().$transaction(
    (tx) => editarAtendimentoNaTransacao(tx, entrada),
    OPCOES_DE_TRANSACAO,
  );
}

async function excluirAtendimentoComCliente(
  cliente: Pick<Prisma.TransactionClient, "atendimento">,
  atendimentoId: number,
): Promise<ResultadoExclusaoDeAtendimento> {
  if (!Number.isInteger(atendimentoId) || atendimentoId <= 0) {
    return { ok: false, erro: ERRO_ATENDIMENTO_ID_INVALIDO };
  }

  const exclusao = await cliente.atendimento.deleteMany({
    where: { id: atendimentoId },
  });

  if (exclusao.count === 0) {
    return { ok: false, erro: ERRO_ATENDIMENTO_INEXISTENTE };
  }

  return { ok: true };
}

/** Exclui um atendimento usando o cliente de uma transação já aberta. */
export async function excluirAtendimentoNaTransacao(
  tx: Prisma.TransactionClient,
  atendimentoId: number,
): Promise<ResultadoExclusaoDeAtendimento> {
  return excluirAtendimentoComCliente(tx, atendimentoId);
}

/** Exclui um atendimento pelo id. */
export async function excluirAtendimentoPeloId(
  atendimentoId: number,
): Promise<ResultadoExclusaoDeAtendimento> {
  return excluirAtendimentoComCliente(getPrismaClient(), atendimentoId);
}

/**
 * O dia de "hoje" segundo o **banco**, como "AAAA-MM-DD".
 *
 * É o valor que a tela usa como data padrão do atendimento. Vem do
 * `CURRENT_DATE` do Postgres, e não do relógio do Node, porque é o mesmo
 * "hoje" que a view usa para decidir "Renovar" por validade. Se os dois
 * discordassem (servidor em UTC, clínica em horário de Brasília), o
 * atendimento lançado à noite já cairia no dia seguinte enquanto o alerta de
 * validade ainda contaria o dia anterior.
 */
export async function dataDeHoje(): Promise<string> {
  const [linha] = await getPrismaClient().$queryRaw<{ hoje: string }[]>`
    SELECT CURRENT_DATE::text AS "hoje"
  `;

  return linha.hoje;
}

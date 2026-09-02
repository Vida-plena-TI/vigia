/**
 * Leitura das guias (`requisicao_terapia`) para o dashboard e regra de
 * exclusão de guia.
 *
 * Saldo e status **sempre** saem da view `requisicao_terapia_saldo`
 * (CONTEXT.md, "Campos calculados"). Nada aqui recalcula a fórmula em
 * TypeScript — `lib/domain/saldo.ts` é só espelho para teste.
 *
 * A regra 9 do CONTEXT.md (exclusão de guia "Regular" bloqueada) vive em
 * {@link excluirGuiaNaTransacao}, no backend. Esconder o botão na UI é
 * conforto visual, não é a validação.
 */
import { prisma } from "@/lib/db";
import { OPCOES_DE_TRANSACAO } from "@/lib/db/transacao";
import type { Prisma } from "@/lib/generated/prisma/client";

import type { StatusAlerta } from "./saldo";

/** Uma guia como o dashboard precisa dela: view + paciente + terapia. */
export type GuiaDoDashboard = {
  id: number;
  pacienteId: number;
  pacienteNome: string;
  requisicaoId: number;
  numeroRequisicao: string;
  terapiaId: number;
  terapiaNome: string;
  codigoTiss: string;
  qtdAutorizada: number;
  qtdUtilizada: number;
  saldoRestante: number;
  /**
   * `validade` no formato "AAAA-MM-DD", já vinda do Postgres como texto.
   *
   * A coluna é `DATE` (dia civil, sem hora). Convertida para `Date` ela ganha
   * um instante e volta a depender do fuso de quem formata — o que faz a data
   * exibida escorregar um dia. Como o valor só é lido para exibir, ele viaja
   * como texto do banco até a tela.
   */
  validade: string | null;
  statusAlerta: StatusAlerta;
};

/** Guias de um mesmo paciente, na ordem em que devem aparecer. */
export type PacienteComGuias = {
  id: number;
  nome: string;
  guias: GuiaDoDashboard[];
};

/** Um atendimento no histórico de uma guia. */
export type AtendimentoDoHistorico = {
  id: number;
  /** "AAAA-MM-DD", pelo mesmo motivo de {@link GuiaDoDashboard.validade}. */
  dataAtendimento: string;
  creditosConsumidos: number;
  observacao: string | null;
};

/** Contagem de guias por status, para o resumo do topo do dashboard. */
export type ResumoPorStatus = Record<StatusAlerta, number>;

/** Resultado de uma tentativa de exclusão de guia. */
export type ResultadoExclusao = { ok: true } | { ok: false; erro: string };

export const ERRO_ID_INVALIDO = "Identificador de guia inválido.";
export const ERRO_GUIA_INEXISTENTE = "Guia não encontrada.";
export const ERRO_GUIA_REGULAR =
  'Guia com status "Regular" não pode ser excluída.';

/** Os únicos status que autorizam exclusão (regra 9 do CONTEXT.md). */
export const STATUS_QUE_PERMITEM_EXCLUSAO: readonly StatusAlerta[] = [
  "Renovar",
  "Esgotada",
];

/** Linha crua da consulta do dashboard, antes da validação do status. */
type LinhaDoDashboard = Omit<GuiaDoDashboard, "statusAlerta"> & {
  statusAlerta: string;
};

/**
 * Aceita apenas o que a view pode ter produzido.
 *
 * Se a view ganhar um status novo e este código não souber dele, é melhor
 * estourar aqui do que pintar a guia de verde por acidente.
 */
function comoStatusAlerta(valor: string): StatusAlerta {
  if (valor === "Regular" || valor === "Renovar" || valor === "Esgotada") {
    return valor;
  }

  throw new Error(
    `status_alerta inesperado vindo da view: ${JSON.stringify(valor)}`,
  );
}

/**
 * Todas as guias do sistema, com paciente e terapia, ordenadas por nome do
 * paciente.
 *
 * A ordenação usa `lower(nome)` para não jogar nomes com maiúscula na frente,
 * e desempata por id do paciente, nome da terapia e id da guia para o
 * resultado ser estável entre requisições.
 *
 * O `lower()` não é redundante com a collation do banco de desenvolvimento
 * (`Portuguese_Brazil.1252`, que já ordena ignorando caixa): ele é o que faz a
 * ordem continuar a mesma num banco criado com outra collation — `C`, por
 * exemplo, ordena por byte e colocaria todos os nomes maiúsculos antes dos
 * minúsculos.
 */
export async function listarGuiasDoDashboard(): Promise<GuiaDoDashboard[]> {
  const linhas = await prisma.$queryRaw<LinhaDoDashboard[]>`
    SELECT
      s."id"                AS "id",
      p."id"                AS "pacienteId",
      p."nome"              AS "pacienteNome",
      r."id"                AS "requisicaoId",
      r."numero_requisicao" AS "numeroRequisicao",
      t."id"                AS "terapiaId",
      t."nome"              AS "terapiaNome",
      t."codigo_tiss"       AS "codigoTiss",
      s."qtd_autorizada"    AS "qtdAutorizada",
      s."qtd_utilizada"     AS "qtdUtilizada",
      s."saldo_restante"    AS "saldoRestante",
      s."validade"::text    AS "validade",
      s."status_alerta"     AS "statusAlerta"
    FROM "requisicao_terapia_saldo" s
    JOIN "requisicao" r ON r."id" = s."requisicao_id"
    JOIN "paciente"   p ON p."id" = r."paciente_id"
    JOIN "terapia"    t ON t."id" = s."terapia_id"
    ORDER BY lower(p."nome"), p."id", t."nome", s."id"
  `;

  return linhas.map((linha) => ({
    ...linha,
    statusAlerta: comoStatusAlerta(linha.statusAlerta),
  }));
}

/**
 * Agrupa as guias por paciente preservando a ordem de entrada.
 *
 * Depende de `listarGuiasDoDashboard` já vir ordenada: as guias de um mesmo
 * paciente chegam em sequência, então o agrupamento não reordena nada.
 */
export function agruparPorPaciente(
  guias: readonly GuiaDoDashboard[],
): PacienteComGuias[] {
  const porPaciente = new Map<number, PacienteComGuias>();

  for (const guia of guias) {
    const existente = porPaciente.get(guia.pacienteId);

    if (existente) {
      existente.guias.push(guia);
      continue;
    }

    porPaciente.set(guia.pacienteId, {
      id: guia.pacienteId,
      nome: guia.pacienteNome,
      guias: [guia],
    });
  }

  return [...porPaciente.values()];
}

/** Quantas guias há em cada status. */
export function contarPorStatus(
  guias: readonly GuiaDoDashboard[],
): ResumoPorStatus {
  const resumo: ResumoPorStatus = { Regular: 0, Renovar: 0, Esgotada: 0 };

  for (const guia of guias) {
    resumo[guia.statusAlerta] += 1;
  }

  return resumo;
}

/** Atendimentos de uma guia, do mais recente para o mais antigo. */
export async function listarAtendimentosDaGuia(
  guiaId: number,
): Promise<AtendimentoDoHistorico[]> {
  if (!Number.isInteger(guiaId) || guiaId <= 0) {
    return [];
  }

  const atendimentos = await prisma.atendimento.findMany({
    where: { requisicaoTerapiaId: guiaId },
    orderBy: [{ dataAtendimento: "desc" }, { id: "desc" }],
    select: {
      id: true,
      dataAtendimento: true,
      creditosConsumidos: true,
      observacao: true,
    },
  });

  return atendimentos.map((atendimento) => ({
    id: atendimento.id,
    // Coluna DATE chega como meia-noite UTC; fatiar o ISO devolve o dia gravado.
    dataAtendimento: atendimento.dataAtendimento.toISOString().slice(0, 10),
    creditosConsumidos: atendimento.creditosConsumidos,
    observacao: atendimento.observacao,
  }));
}

/**
 * Exclusão de guia (regra 9 do CONTEXT.md), já dentro de uma transação.
 *
 * O status é lido da view, nunca recalculado aqui. A ordem importa:
 *
 *   1. `SELECT ... FOR UPDATE` na linha de `requisicao_terapia`, travando a
 *      guia. Sem isso um lançamento de atendimento concorrente (regra 7, que
 *      trava as mesmas linhas) poderia mudar o saldo entre a leitura do status
 *      e o DELETE, e uma guia que voltou a ser "Regular" nesse intervalo seria
 *      apagada mesmo assim;
 *   2. leitura do `status_alerta` da view;
 *   3. DELETE, que leva junto os atendimentos filhos via ON DELETE CASCADE
 *      (regra 10) — o cascade está no banco, não é feito em código.
 *
 * Recebe o cliente da transação em vez de abrir a própria para o teste de
 * integração conseguir rodar tudo dentro de uma transação que sofre rollback.
 *
 * @see excluirGuiaPeloId para a versão que abre a transação sozinha.
 */
export async function excluirGuiaNaTransacao(
  tx: Prisma.TransactionClient,
  guiaId: number,
): Promise<ResultadoExclusao> {
  if (!Number.isInteger(guiaId) || guiaId <= 0) {
    return { ok: false, erro: ERRO_ID_INVALIDO };
  }

  const travadas = await tx.$queryRaw<{ id: number }[]>`
    SELECT "id" FROM "requisicao_terapia" WHERE "id" = ${guiaId} FOR UPDATE
  `;

  if (travadas.length === 0) {
    return { ok: false, erro: ERRO_GUIA_INEXISTENTE };
  }

  const linhas = await tx.$queryRaw<{ statusAlerta: string }[]>`
    SELECT "status_alerta" AS "statusAlerta"
    FROM "requisicao_terapia_saldo"
    WHERE "id" = ${guiaId}
  `;

  if (linhas.length === 0) {
    return { ok: false, erro: ERRO_GUIA_INEXISTENTE };
  }

  const status = comoStatusAlerta(linhas[0].statusAlerta);

  if (!STATUS_QUE_PERMITEM_EXCLUSAO.includes(status)) {
    return { ok: false, erro: ERRO_GUIA_REGULAR };
  }

  await tx.requisicaoTerapia.delete({ where: { id: guiaId } });

  return { ok: true };
}

/**
 * {@link excluirGuiaNaTransacao} abrindo a própria transação.
 *
 * O id é validado aqui também, antes de abrir a transação: não vale gastar uma
 * conexão com o banco por causa de um id que o cliente inventou.
 */
export async function excluirGuiaPeloId(
  guiaId: number,
): Promise<ResultadoExclusao> {
  if (!Number.isInteger(guiaId) || guiaId <= 0) {
    return { ok: false, erro: ERRO_ID_INVALIDO };
  }

  return prisma.$transaction(
    (tx) => excluirGuiaNaTransacao(tx, guiaId),
    OPCOES_DE_TRANSACAO,
  );
}

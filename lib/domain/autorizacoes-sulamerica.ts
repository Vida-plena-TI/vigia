import { getPrismaClient } from "@/lib/db";
import { OPCOES_DE_TRANSACAO } from "@/lib/db/transacao";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { StatusEncaminhamento } from "./encaminhamentos";
import { obterOuCriarPaciente } from "./pacientes";
import {
  ERRO_AUTORIZACAO_INEXISTENTE, ERRO_DATA_INVALIDA, ERRO_ID_INVALIDO,
  ERRO_PACIENTE_OBRIGATORIO, ERRO_PRAZO_INVALIDO,
} from "./autorizacoes-sulamerica-mensagens";

export type EntradaAutorizacao = {
  pacienteNome: string;
  dataInicio: string;
  prazoMeses: number;
};

export type AutorizacaoNaLista = {
  id: number;
  pacienteId: number;
  pacienteNome: string;
  dataInicio: string;
  prazoMeses: number;
  dataVencimento: string;
  statusAutorizacao: StatusEncaminhamento | null;
};

type Falha = { ok: false; erro: string };
export type ResultadoGravacao = Falha | {
  ok: true;
  id: number;
  pacienteNome: string;
  pacienteCriado: boolean;
  dataInicio: string;
  prazoMeses: number;
  dataVencimento: string;
  substituiuAnterior: boolean;
};
export type ResultadoExclusao = Falha | { ok: true };

// Valida também tipos em runtime: Server Actions aceitam POST direto.
export function validarEntrada(entrada: EntradaAutorizacao): { ok: true } | Falha {
  if (typeof entrada?.pacienteNome !== "string" || !entrada.pacienteNome.trim()) {
    return { ok: false, erro: ERRO_PACIENTE_OBRIGATORIO };
  }
  const data = typeof entrada.dataInicio === "string" ? entrada.dataInicio.trim() : "";
  const convertida = new Date(`${data}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || data.startsWith("0000") ||
      Number.isNaN(convertida.getTime()) || convertida.toISOString().slice(0, 10) !== data) {
    return { ok: false, erro: ERRO_DATA_INVALIDA };
  }
  if (![3, 6, 12].includes(entrada.prazoMeses)) {
    return { ok: false, erro: ERRO_PRAZO_INVALIDO };
  }
  return { ok: true };
}

/** Paciente e autorização nascem juntos. O vencimento só é lido do RETURNING. */
export async function registrarAutorizacaoNaTransacao(
  tx: Prisma.TransactionClient,
  entrada: EntradaAutorizacao,
): Promise<ResultadoGravacao> {
  const validacao = validarEntrada(entrada);
  if (!validacao.ok) return validacao;

  const paciente = await obterOuCriarPaciente(tx, entrada.pacienteNome.trim());
  // Serializa inclusive o primeiro cadastro, para a confirmação de substituição
  // refletir corretamente dois envios concorrentes do mesmo paciente.
  await tx.$queryRaw`SELECT "id" FROM "paciente" WHERE "id" = ${paciente.id} FOR UPDATE`;
  const anteriores = await tx.$queryRaw<{ id: number }[]>`
    SELECT "id" FROM "autorizacao_sulamerica" WHERE "paciente_id" = ${paciente.id}
  `;
  const [linha] = await tx.$queryRaw<{
    id: number; dataInicio: string; prazoMeses: number; dataVencimento: string;
  }[]>`
    INSERT INTO "autorizacao_sulamerica" ("paciente_id", "data_inicio", "prazo_meses")
    VALUES (${paciente.id}, ${entrada.dataInicio.trim()}::date, ${entrada.prazoMeses})
    ON CONFLICT ("paciente_id") DO UPDATE SET
      "data_inicio" = EXCLUDED."data_inicio", "prazo_meses" = EXCLUDED."prazo_meses"
    RETURNING "id", "data_inicio"::text AS "dataInicio", "prazo_meses" AS "prazoMeses",
      "data_vencimento"::text AS "dataVencimento"
  `;
  return {
    ok: true, ...linha, pacienteNome: paciente.nome, pacienteCriado: paciente.criado,
    substituiuAnterior: anteriores.length > 0,
  };
}

export async function registrarAutorizacao(entrada: EntradaAutorizacao): Promise<ResultadoGravacao> {
  const validacao = validarEntrada(entrada);
  if (!validacao.ok) return validacao;
  return getPrismaClient().$transaction(
    (tx) => registrarAutorizacaoNaTransacao(tx, entrada), OPCOES_DE_TRANSACAO,
  );
}

/** DELETE único, sem excluir paciente ou qualquer registro do Klini. */
export async function excluirAutorizacaoComCliente(
  cliente: Pick<Prisma.TransactionClient, "$executeRaw">,
  id: number,
): Promise<ResultadoExclusao> {
  if (!Number.isInteger(id) || id <= 0) return { ok: false, erro: ERRO_ID_INVALIDO };
  const apagadas = await cliente.$executeRaw`DELETE FROM "autorizacao_sulamerica" WHERE "id" = ${id}`;
  return apagadas > 0 ? { ok: true } : { ok: false, erro: ERRO_AUTORIZACAO_INEXISTENTE };
}

export async function excluirAutorizacao(id: number): Promise<ResultadoExclusao> {
  return excluirAutorizacaoComCliente(getPrismaClient(), id);
}

/** A view classifica; o ORDER BY apenas ordena os rótulos já produzidos. */
export async function listarAutorizacoesComCliente(
  cliente: Pick<Prisma.TransactionClient, "$queryRaw">,
): Promise<AutorizacaoNaLista[]> {
  const linhas = await cliente.$queryRaw<AutorizacaoNaLista[]>`
    SELECT s."id", p."id" AS "pacienteId", p."nome" AS "pacienteNome",
      s."data_inicio"::text AS "dataInicio", s."prazo_meses" AS "prazoMeses",
      s."data_vencimento"::text AS "dataVencimento", s."status_autorizacao" AS "statusAutorizacao"
    FROM "autorizacao_sulamerica_status" s JOIN "paciente" p ON p."id" = s."paciente_id"
    ORDER BY CASE s."status_autorizacao"
      WHEN 'Vencido' THEN 1 WHEN 'Vence este mês' THEN 2 WHEN 'A vencer' THEN 3 ELSE 4 END,
      lower(p."nome")
  `;
  for (const linha of linhas) {
    if (linha.statusAutorizacao !== null &&
        !["Vencido", "Vence este mês", "A vencer"].includes(linha.statusAutorizacao)) {
      throw new Error(`Status SulAmérica desconhecido: ${linha.statusAutorizacao}`);
    }
  }
  return linhas;
}

export async function listarAutorizacoes() {
  return listarAutorizacoesComCliente(getPrismaClient());
}

export function contarPorStatusDeAutorizacao(linhas: readonly AutorizacaoNaLista[]) {
  const resumo: Record<StatusEncaminhamento, number> = { Vencido: 0, "Vence este mês": 0, "A vencer": 0 };
  for (const linha of linhas) {
    if (linha.statusAutorizacao !== null) resumo[linha.statusAutorizacao] += 1;
  }
  return resumo;
}

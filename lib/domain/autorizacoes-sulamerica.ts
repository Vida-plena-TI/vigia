import { getPrismaClient } from "@/lib/db";
import { OPCOES_DE_TRANSACAO } from "@/lib/db/transacao";
import type { Prisma } from "@/lib/generated/prisma/client";
import { normalizarCarteirinha, validarCarteirinha, validarCrm } from "./carteirinha-crm";
import { ErroDeNegocio, gravarCarteirinhaECrmNaTransacao } from "./carteirinha-crm-gravacao";
import type { StatusEncaminhamento } from "./encaminhamentos";
import { normalizarNomeMedico, validarNomeMedico } from "./nome-medico";
import { obterOuCriarPaciente } from "./pacientes";
import {
  ERRO_AUTORIZACAO_INEXISTENTE, ERRO_DATA_INVALIDA, ERRO_ID_INVALIDO,
  ERRO_PACIENTE_OBRIGATORIO, ERRO_PRAZO_INVALIDO,
} from "./autorizacoes-sulamerica-mensagens";

/**
 * O cadastro de encaminhamento da SulAmérica (`/sulamerica/encaminhamentos`).
 * `dataInicio` é a data do encaminhamento. Carteirinha, CRM e nome do médico
 * chegam como foram digitados; a normalização é do domínio. A carteirinha
 * vazia é aceita só quando o paciente já tem uma (regra 20).
 */
export type EntradaAutorizacao = {
  pacienteNome: string;
  dataInicio: string;
  prazoMeses: number;
  numeroCarteirinha: string;
  crmMedico: string;
  nomeMedico: string;
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

/**
 * Linha da aba Encaminhamentos: a do painel mais os dados do paciente e o
 * médico. Os três são `null` no legado (antes de 28/10/2026). Só a página
 * `/sulamerica/encaminhamentos` (admin) recebe esta forma — o painel recebe
 * {@link AutorizacaoNaLista}, sem os números.
 */
export type EncaminhamentoSulamericaNaLista = AutorizacaoNaLista & {
  numeroCarteirinha: string | null;
  crmMedico: string | null;
  nomeMedico: string | null;
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
  // Na ordem dos campos do formulário. A carteirinha aqui é só formato: se
  // vazia é aceitável depende do paciente, e isso só a transação sabe.
  const carteirinha = typeof entrada.numeroCarteirinha === "string" ? entrada.numeroCarteirinha : "";
  if (normalizarCarteirinha(carteirinha)) {
    const validacao = validarCarteirinha(carteirinha);
    if (!validacao.ok) return validacao;
  }
  const crm = validarCrm(typeof entrada.crmMedico === "string" ? entrada.crmMedico : "");
  if (!crm.ok) return crm;
  const nomeMedico = validarNomeMedico(entrada.nomeMedico);
  if (!nomeMedico.ok) return nomeMedico;
  return { ok: true };
}

/**
 * Paciente, carteirinha/CRM e autorização nascem juntos, na mesma ordem de
 * lock do encaminhamento da Klini: get-or-create do paciente → paciente
 * travado (`FOR NO KEY UPDATE`, em `gravarCarteirinhaECrmNaTransacao`) →
 * autorização anterior travada → upsert. Este e o da Klini são os únicos
 * lugares que criam paciente (regra 21). Recusa é `throw`, para desfazer o
 * paciente recém-criado. Entrada já validada por `validarEntrada` (nome do
 * médico inclusive); aqui ele só é normalizado. O vencimento só é lido do
 * RETURNING.
 */
async function gravarNaTransacao(
  tx: Prisma.TransactionClient,
  entrada: EntradaAutorizacao,
): Promise<Extract<ResultadoGravacao, { ok: true }>> {
  const paciente = await obterOuCriarPaciente(tx, entrada.pacienteNome.trim());
  await gravarCarteirinhaECrmNaTransacao(tx, paciente, entrada.numeroCarteirinha, entrada.crmMedico);

  // O lock do paciente (acima) já serializa dois envios do mesmo paciente,
  // inclusive o primeiro; o FOR UPDATE trava a linha existente, como na Klini.
  const anteriores = await tx.$queryRaw<{ id: number }[]>`
    SELECT "id" FROM "autorizacao_sulamerica" WHERE "paciente_id" = ${paciente.id} FOR UPDATE
  `;
  let linha: { id: number; dataInicio: string; prazoMeses: number; dataVencimento: string };
  try {
    [linha] = await tx.$queryRaw<(typeof linha)[]>`
      INSERT INTO "autorizacao_sulamerica" ("paciente_id", "data_inicio", "prazo_meses", "nome_medico")
      VALUES (${paciente.id}, ${entrada.dataInicio.trim()}::date, ${entrada.prazoMeses}, ${normalizarNomeMedico(entrada.nomeMedico)})
      ON CONFLICT ("paciente_id") DO UPDATE SET
        "data_inicio" = EXCLUDED."data_inicio", "prazo_meses" = EXCLUDED."prazo_meses",
        "nome_medico" = EXCLUDED."nome_medico"
      RETURNING "id", "data_inicio"::text AS "dataInicio", "prazo_meses" AS "prazoMeses",
        "data_vencimento"::text AS "dataVencimento"
    `;
  } catch (erro) {
    // Saneado, como em `gravarCarteirinhaECrm`: a violação de CHECK traz a
    // linha inteira (nome do médico inclusive) no erro, que seria logado. Na
    // prática é inalcançável — `validarEntrada` recusa antes.
    const codigo = (erro as { code?: unknown } | null)?.code;
    throw new Error(
      `falha ao gravar autorização SulAmérica do paciente ${paciente.id} (${String(codigo ?? "sem codigo")})`,
    );
  }
  return {
    ok: true, ...linha, pacienteNome: paciente.nome, pacienteCriado: paciente.criado,
    substituiuAnterior: anteriores.length > 0,
  };
}

/** Em produção: a transação é desta função, e a recusa desfaz tudo. */
export async function registrarAutorizacao(entrada: EntradaAutorizacao): Promise<ResultadoGravacao> {
  const validacao = validarEntrada(entrada);
  if (!validacao.ok) return validacao;
  try {
    return await getPrismaClient().$transaction(
      (tx) => gravarNaTransacao(tx, entrada), OPCOES_DE_TRANSACAO,
    );
  } catch (erro) {
    if (erro instanceof ErroDeNegocio) return { ok: false, erro: erro.erro };
    throw erro;
  }
}

/**
 * Para o teste de integração, numa transação já aberta. A recusa vira
 * `{ ok: false }` **sem desfazer nada**: o rollback é do chamador. Em produção
 * use {@link registrarAutorizacao}.
 */
export async function registrarAutorizacaoNaTransacao(
  tx: Prisma.TransactionClient,
  entrada: EntradaAutorizacao,
): Promise<ResultadoGravacao> {
  const validacao = validarEntrada(entrada);
  if (!validacao.ok) return validacao;
  try {
    return await gravarNaTransacao(tx, entrada);
  } catch (erro) {
    if (erro instanceof ErroDeNegocio) return { ok: false, erro: erro.erro };
    throw erro;
  }
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

/**
 * A view classifica; o ORDER BY apenas ordena os rótulos já produzidos.
 * `nome_medico` não está na view (criada antes da coluna): vem da tabela.
 */
export async function listarAutorizacoesComCliente(
  cliente: Pick<Prisma.TransactionClient, "$queryRaw">,
): Promise<EncaminhamentoSulamericaNaLista[]> {
  const linhas = await cliente.$queryRaw<EncaminhamentoSulamericaNaLista[]>`
    SELECT s."id", p."id" AS "pacienteId", p."nome" AS "pacienteNome",
      s."data_inicio"::text AS "dataInicio", s."prazo_meses" AS "prazoMeses",
      s."data_vencimento"::text AS "dataVencimento", s."status_autorizacao" AS "statusAutorizacao",
      p."numero_carteirinha" AS "numeroCarteirinha", p."crm_medico" AS "crmMedico",
      a."nome_medico" AS "nomeMedico"
    FROM "autorizacao_sulamerica_status" s
    JOIN "autorizacao_sulamerica" a ON a."id" = s."id"
    JOIN "paciente" p ON p."id" = s."paciente_id"
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

/** Para o painel: sem carteirinha, CRM nem médico, que ficam na aba Encaminhamentos. */
export async function listarAutorizacoes(): Promise<AutorizacaoNaLista[]> {
  const linhas = await listarAutorizacoesComCliente(getPrismaClient());
  return linhas.map((linha) => ({
    id: linha.id, pacienteId: linha.pacienteId, pacienteNome: linha.pacienteNome,
    dataInicio: linha.dataInicio, prazoMeses: linha.prazoMeses,
    dataVencimento: linha.dataVencimento, statusAutorizacao: linha.statusAutorizacao,
  }));
}

/** Para `/sulamerica/encaminhamentos` (só admin): a linha com os dados do paciente. */
export async function listarEncaminhamentosSulamerica(): Promise<EncaminhamentoSulamericaNaLista[]> {
  return listarAutorizacoesComCliente(getPrismaClient());
}

export function contarPorStatusDeAutorizacao(linhas: readonly AutorizacaoNaLista[]) {
  const resumo: Record<StatusEncaminhamento, number> = { Vencido: 0, "Vence este mês": 0, "A vencer": 0 };
  for (const linha of linhas) {
    if (linha.statusAutorizacao !== null) resumo[linha.statusAutorizacao] += 1;
  }
  return resumo;
}

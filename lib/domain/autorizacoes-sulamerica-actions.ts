"use server";

import { refresh } from "next/cache";
import { MENSAGEM_SEM_PERMISSAO, ROTA_SULAMERICA } from "@/lib/auth/acesso";
import { autorizarRota } from "@/lib/auth/current-user";
import { registrarAutorizacao, excluirAutorizacao, type ResultadoGravacao } from "./autorizacoes-sulamerica";

export type EstadoNovaAutorizacao = {
  erro?: string;
  sucesso?: Extract<ResultadoGravacao, { ok: true }> & { token: string };
};

export async function criarAutorizacaoAction(
  _prev: EstadoNovaAutorizacao, dados: FormData,
): Promise<EstadoNovaAutorizacao> {
  // autorizarRota relê o papel no banco. SulAmérica está fora do allowlist da recepção.
  if (!(await autorizarRota(ROTA_SULAMERICA))) return { erro: MENSAGEM_SEM_PERMISSAO };
  const resultado = await registrarAutorizacao({
    pacienteNome: String(dados.get("pacienteNome") ?? ""),
    dataInicio: String(dados.get("dataInicio") ?? ""),
    prazoMeses: Number(dados.get("prazoMeses") ?? ""),
  });
  if (!resultado.ok) return { erro: resultado.erro };
  refresh();
  return { sucesso: { ...resultado, token: crypto.randomUUID() } };
}

export async function excluirAutorizacaoAction(id: number) {
  if (!(await autorizarRota(ROTA_SULAMERICA))) {
    return { ok: false as const, erro: MENSAGEM_SEM_PERMISSAO };
  }
  const resultado = await excluirAutorizacao(id);
  if (resultado.ok) refresh();
  return resultado;
}

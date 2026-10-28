"use server";

import { refresh } from "next/cache";
import {
  MENSAGEM_SEM_PERMISSAO, ROTA_SULAMERICA, ROTA_SULAMERICA_ENCAMINHAMENTOS,
} from "@/lib/auth/acesso";
import { autorizarRota } from "@/lib/auth/current-user";
import { registrarAutorizacao, excluirAutorizacao, type EntradaAutorizacao } from "./autorizacoes-sulamerica";

/**
 * Estado do formulário de `/sulamerica/encaminhamentos`. O sucesso leva só
 * nome e datas: carteirinha, CRM e nome do médico não voltam ao cliente.
 */
export type EstadoNovoEncaminhamentoSulamerica = {
  erro?: string;
  sucesso?: {
    pacienteNome: string;
    dataInicio: string;
    prazoMeses: number;
    dataVencimento: string;
    substituiuAnterior: boolean;
    token: string;
  };
};

export async function criarEncaminhamentoSulamericaAction(
  _prev: EstadoNovoEncaminhamentoSulamerica, dados: FormData,
): Promise<EstadoNovoEncaminhamentoSulamerica> {
  // autorizarRota relê o papel no banco. SulAmérica está fora do allowlist da recepção.
  if (!(await autorizarRota(ROTA_SULAMERICA_ENCAMINHAMENTOS))) return { erro: MENSAGEM_SEM_PERMISSAO };
  // Carteirinha, CRM e médico só pelo corpo do POST, nunca por query string.
  const entrada: EntradaAutorizacao = {
    pacienteNome: String(dados.get("pacienteNome") ?? ""),
    dataInicio: String(dados.get("dataInicio") ?? ""),
    prazoMeses: Number(dados.get("prazoMeses") ?? ""),
    numeroCarteirinha: String(dados.get("numeroCarteirinha") ?? ""),
    crmMedico: String(dados.get("crmMedico") ?? ""),
    nomeMedico: String(dados.get("nomeMedico") ?? ""),
  };
  const resultado = await registrarAutorizacao(entrada);
  if (!resultado.ok) return { erro: resultado.erro };
  refresh();
  return {
    sucesso: {
      pacienteNome: resultado.pacienteNome,
      dataInicio: resultado.dataInicio,
      prazoMeses: resultado.prazoMeses,
      dataVencimento: resultado.dataVencimento,
      substituiuAnterior: resultado.substituiuAnterior,
      token: crypto.randomUUID(),
    },
  };
}

export async function excluirAutorizacaoAction(id: number) {
  if (!(await autorizarRota(ROTA_SULAMERICA))) {
    return { ok: false as const, erro: MENSAGEM_SEM_PERMISSAO };
  }
  const resultado = await excluirAutorizacao(id);
  if (resultado.ok) refresh();
  return resultado;
}

"use server";

/**
 * Server Action do cadastro de encaminhamento.
 *
 * Como toda action do projeto, é alcançável por um POST direto sem passar pela
 * UI — por isso `requireUsuario()` (regra 4 do CONTEXT.md) vem antes de
 * qualquer leitura do formulário, e a validação de verdade mora em
 * `lib/domain/encaminhamentos.ts`, não no JavaScript da página.
 *
 * Sucesso não navega: `refresh()` redesenha o Server Component da própria
 * página, e a listagem logo abaixo do formulário já volta com o registro novo.
 * É o mesmo desenho de "Lançar atendimento" — quem cadastra vários seguidos não
 * deveria esperar uma navegação entre um e outro.
 */

import { refresh } from "next/cache";

import { requireUsuario } from "@/lib/auth/current-user";

import {
  criarEncaminhamento,
  type EntradaNovoEncaminhamento,
} from "./encaminhamentos";

/** Estado que o formulário lê de volta via `useActionState`. */
export type EstadoNovoEncaminhamento = {
  erro?: string;
  /** Presente só no sucesso. É ele que dispara a limpeza do formulário. */
  sucesso?: {
    pacienteNome: string;
    /** "AAAA-MM-DD". */
    dataEncaminhamento: string;
    /** "AAAA-MM-DD", vinda da coluna gerada pelo banco. */
    dataVencimento: string;
    /**
     * Identificador da criação, único por submissão.
     *
     * O formulário guarda o último token já tratado para não repetir a limpeza
     * no StrictMode nem confundir dois cadastros idênticos no shape.
     */
    token: string;
  };
};

export async function criarEncaminhamentoAction(
  _prev: EstadoNovoEncaminhamento,
  formData: FormData,
): Promise<EstadoNovoEncaminhamento> {
  await requireUsuario();

  const entrada: EntradaNovoEncaminhamento = {
    pacienteNome: String(formData.get("pacienteNome") ?? ""),
    dataEncaminhamento: String(formData.get("dataEncaminhamento") ?? ""),
  };

  const resultado = await criarEncaminhamento(entrada);

  if (!resultado.ok) {
    return { erro: resultado.erro };
  }

  refresh();

  return {
    sucesso: {
      pacienteNome: resultado.pacienteNome,
      dataEncaminhamento: resultado.dataEncaminhamento,
      dataVencimento: resultado.dataVencimento,
      token: crypto.randomUUID(),
    },
  };
}

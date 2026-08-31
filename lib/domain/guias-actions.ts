"use server";

/**
 * Server Actions das guias.
 *
 * Toda função daqui é alcançável por um POST direto, sem passar pela UI — é
 * exatamente por isso que a regra 4 do CONTEXT.md exige `requireUsuario()` em
 * cada uma, e a regra 9 (bloquear exclusão de guia "Regular") mora no
 * backend, em `excluirGuiaNaTransacao`, e não no `if` que esconde o botão.
 *
 * O `id` chega do cliente e é tratado como entrada não confiável: quem valida
 * é `lib/domain/guias.ts`.
 */

import { refresh } from "next/cache";

import { requireUsuario } from "@/lib/auth/current-user";

import {
  excluirGuiaPeloId,
  listarAtendimentosDaGuia,
  type AtendimentoDoHistorico,
  type ResultadoExclusao,
} from "./guias";

/**
 * Exclui uma guia, se o status permitir.
 *
 * Devolve o erro em vez de lançar: a falha esperada aqui (guia "Regular") é
 * uma mensagem para o usuário, não uma exceção.
 */
export async function excluirGuia(
  guiaId: number,
): Promise<ResultadoExclusao> {
  await requireUsuario();

  const resultado = await excluirGuiaPeloId(guiaId);

  if (resultado.ok) {
    // Nada é cacheado (a página é dinâmica por causa da sessão); o refresh é
    // para o router do cliente redesenhar a lista sem a guia apagada.
    refresh();
  }

  return resultado;
}

/** Atendimentos de uma guia, para o diálogo de histórico do dashboard. */
export async function listarHistoricoDaGuia(
  guiaId: number,
): Promise<AtendimentoDoHistorico[]> {
  await requireUsuario();

  return listarAtendimentosDaGuia(guiaId);
}

"use server";

/**
 * Server Action da situação da requisição (solicitada/aprovada).
 *
 * Só o `admin` altera. O botão some do painel para a recepção, mas esconder o
 * botão é conveniência: esta action é alcançável por POST direto, e quem
 * recusa é a checagem abaixo, com o papel lido do **banco** por
 * `requireUsuario()` — nunca o do cookie. Mesma postura de `autorizarRota()`:
 * a recusa devolve mensagem em vez de lançar, porque o chamador legítimo
 * desse caminho é uma aba aberta antes de o papel mudar.
 *
 * Os dois argumentos chegam do cliente e são tratados como entrada não
 * confiável: quem valida id e situação é `alterarSituacaoDaRequisicao`.
 */

import { revalidatePath } from "next/cache";

import {
  MENSAGEM_SEM_PERMISSAO,
  podeAlterarSituacaoDeRequisicao,
} from "@/lib/auth/acesso";
import { requireUsuario } from "@/lib/auth/current-user";

import {
  alterarSituacaoDaRequisicao,
  type ResultadoAlteracaoDeSituacao,
} from "./requisicoes";

/** As duas telas que mostram a situação e por isso precisam ser redesenhadas. */
const ROTA_PAINEL = "/klini/dashboard";
const ROTA_LANCAR_ATENDIMENTO = "/klini/atendimentos/novo";

export async function alterarSituacaoDaRequisicaoAction(
  requisicaoId: number,
  situacao: string,
): Promise<ResultadoAlteracaoDeSituacao> {
  const usuario = await requireUsuario();

  if (!podeAlterarSituacaoDeRequisicao(usuario.papel)) {
    return { ok: false, erro: MENSAGEM_SEM_PERMISSAO };
  }

  const resultado = await alterarSituacaoDaRequisicao(
    Number(requisicaoId),
    String(situacao),
  );

  if (resultado.ok) {
    // O painel mostra a situação em cada guia; a tela de lançamento decide
    // por ela quais guias podem ser marcadas.
    revalidatePath(ROTA_PAINEL);
    revalidatePath(ROTA_LANCAR_ATENDIMENTO);
  }

  return resultado;
}

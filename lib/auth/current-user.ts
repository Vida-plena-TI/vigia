import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { getPrismaClient } from "@/lib/db";

import { urlDeLogin } from "./next-path";
import { getSession } from "./session";

export type UsuarioAutenticado = {
  id: number;
  username: string;
};

/**
 * Fonte de verdade da autenticacao: le a sessao do cookie e confirma no banco
 * que o usuario ainda existe e continua ativo.
 *
 * O `proxy.ts` faz apenas a checagem otimista do cookie (sem banco); e aqui que
 * a decisao vale. Server Actions tambem devem chamar isso — uma Server Action e
 * alcancavel por POST direto, sem passar pela UI.
 *
 * `cache` deduplica a consulta dentro de uma mesma requisicao (layout + pagina
 * + actions leem o usuario sem baterem N vezes no banco).
 */
export const getUsuarioAtual = cache(
  async (): Promise<UsuarioAutenticado | null> => {
    const session = await getSession();

    if (!session.usuarioId) {
      return null;
    }

    const usuario = await getPrismaClient().usuario.findUnique({
      where: { id: session.usuarioId },
      select: { id: true, username: true, ativo: true },
    });

    if (!usuario || !usuario.ativo) {
      return null;
    }

    return { id: usuario.id, username: usuario.username };
  },
);

/**
 * Exige um usuario autenticado e ativo.
 *
 * Sem sessao -> manda para o login preservando o caminho de origem.
 * Sessao apontando para usuario inexistente/inativo -> passa pelo route handler
 * de logout, que apaga o cookie (um Server Component nao pode escrever cookie)
 * e so entao cai no login.
 */
export async function requireUsuario(
  pathname?: string | null,
): Promise<UsuarioAutenticado> {
  const session = await getSession();

  if (!session.usuarioId) {
    redirect(urlDeLogin(pathname));
  }

  const usuario = await getUsuarioAtual();

  if (!usuario) {
    redirect(`/api/auth/logout?next=${encodeURIComponent(pathname ?? "/")}`);
  }

  return usuario;
}

import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { getPrismaClient } from "@/lib/db";

import { urlDeLogin } from "./next-path";
import { ehPapelValido, type PapelUsuario } from "./papel";
import { getSession } from "./session";

export type UsuarioAutenticado = {
  id: number;
  username: string;
  /**
   * Papel lido do **banco**, nao do cookie. Esta e a leitura autoritativa: ela
   * enxerga um papel trocado depois que a sessao foi selada, coisa que a copia
   * em `SessionData` nao enxerga ate o proximo login.
   *
   * Na Fase A ninguem decide nada com ele — nenhuma rota e nenhuma Server
   * Action ramifica por papel. O campo existe para as fases seguintes.
   */
  papel: PapelUsuario;
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
      select: { id: true, username: true, ativo: true, papel: true },
    });

    if (!usuario || !usuario.ativo) {
      return null;
    }

    if (!ehPapelValido(usuario.papel)) {
      // Inalcancavel enquanto o CHECK `usuario_papel_valido` estiver de pe: o
      // banco nao aceita gravar outro valor. Fica como recusa explicita — se um
      // papel novo entrar no banco sem entrar em `PAPEIS`, a conta perde o
      // acesso (e o operador ve o login falhar) em vez de circular pelo sistema
      // com um papel que o TypeScript acha que conhece.
      return null;
    }

    return {
      id: usuario.id,
      username: usuario.username,
      papel: usuario.papel,
    };
  },
);

/**
 * Exige um usuario autenticado e ativo.
 *
 * Devolve tambem o `papel` do usuario (Fase A). Isto **nao** e controle de
 * acesso: nada aqui barra ninguem por papel, e nenhuma chamada existente
 * precisou mudar. Quem for implementar a Fase C ramifica a partir deste
 * retorno, nao a partir do cookie.
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

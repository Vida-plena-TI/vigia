import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { getPrismaClient } from "@/lib/db";

import { ROTA_PADRAO_DA_RECEPCAO, podeAcessarRota } from "./acesso";
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
   * Desde a Fase C e com ele que `requireAcessoARota()` e `autorizarRota()`
   * decidem — e e por isso que elas nao leem o cookie.
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
 * Devolve tambem o `papel`, mas **nao** barra por ele: quem faz isso sao
 * `requireAcessoARota()` (paginas) e `autorizarRota()` (Server Actions), logo
 * abaixo. As rotas que qualquer usuario autenticado alcanca continuam usando
 * so esta funcao.
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

/**
 * Exige um usuario autenticado, ativo **e** com papel que alcance `rota`.
 *
 * E a camada autoritativa da Fase C para paginas, e a contraparte exata do que
 * o `proxy.ts` faz de forma otimista: o proxy decide pelo cookie (copia velha,
 * e nem sempre roda), esta decide pelo papel lido do banco na propria
 * requisicao. Toda pagina restrita chama isto no lugar de `requireUsuario()`.
 *
 * Sem permissao -> mesmo destino do proxy: o painel. O usuario esta logado; o
 * que falta e permissao, nao identificacao.
 */
export async function requireAcessoARota(
  rota: string,
  pathname?: string | null,
): Promise<UsuarioAutenticado> {
  const usuario = await requireUsuario(pathname);

  if (!podeAcessarRota(usuario.papel, rota)) {
    redirect(ROTA_PADRAO_DA_RECEPCAO);
  }

  return usuario;
}

/**
 * Versao para Server Actions: devolve o usuario, ou `null` quando o papel dele
 * nao alcanca `rota`.
 *
 * Nao redireciona — uma action recusada devolve mensagem ao formulario, que e o
 * que o chamador legitimo (uma aba velha, aberta antes de o papel mudar)
 * precisa ver. Um POST montado a mao recebe a mesma recusa e nada acontece no
 * banco, que e o ponto: sem isto, toda a protecao da Fase C moraria na
 * navegacao, e navegacao se contorna com um `curl`.
 *
 * Nao autenticado continua caindo no redirect de `requireUsuario()`.
 */
export async function autorizarRota(
  rota: string,
): Promise<UsuarioAutenticado | null> {
  const usuario = await requireUsuario();

  return podeAcessarRota(usuario.papel, rota) ? usuario : null;
}

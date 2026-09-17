import { unsealData } from "iron-session";
import { NextResponse, type NextRequest } from "next/server";

import { ROTA_PADRAO_DA_RECEPCAO, podeAcessarRota } from "@/lib/auth/acesso";
import { urlDeLogin } from "@/lib/auth/next-path";
import { ehPapelValido, type PapelUsuario } from "@/lib/auth/papel";
import { PATHNAME_HEADER } from "@/lib/auth/pathname-header";
import {
  SESSION_COOKIE_NAME,
  sessionSecret,
  sessionTtlSeconds,
  type SessionData,
} from "@/lib/auth/session-options";

/**
 * Triagem de autenticacao (o antigo `middleware.ts`, renomeado para `proxy.ts`
 * no Next.js 16).
 *
 * Aqui a checagem e OTIMISTA e barata: so abre o cookie assinado para ver se
 * existe uma sessao valida e nao expirada. Nao consulta o banco — quem confirma
 * que o usuario ainda existe e esta ativo e o `requireUsuario` do layout
 * `app/(app)/layout.tsx` (e as Server Actions), que sao alcancados mesmo quando
 * o proxy nao roda.
 *
 * Desde a Fase C ele tambem le o `papel` do cookie e desvia a recepcao das
 * rotas que ela nao alcanca (ver `lib/auth/acesso.ts`). Isso continua sendo
 * otimista, e pela mesma razao: o papel do cookie e uma copia selada no login,
 * que envelhece. A recusa que vale esta na pagina e na Server Action, que leem
 * o papel do banco.
 */

/**
 * Rotas abertas: nao exigem sessao **nem** qualquer outra credencial.
 */
const ROTAS_PUBLICAS = ["/login", "/api/auth"];

/**
 * Rotas que autenticam a si mesmas e por isso pulam a triagem de sessao.
 *
 * Nao sao publicas: cada uma tem uma credencial propria, checada dentro do
 * proprio route handler. O que elas nao tem — e nunca vao ter — e cookie de
 * sessao de usuario, porque quem as chama nao e um navegador logado.
 *
 * `/api/cron` cobre o relatorio semanal (`/api/cron/relatorio-semanal`, ver
 * `vercel.json`) e qualquer cron futuro. O Vercel Cron chama a rota
 * servidor-a-servidor com `Authorization: Bearer $CRON_SECRET`, sem cookie
 * nenhum; a checagem real do segredo vive em
 * `app/api/cron/relatorio-semanal/route.ts` e continua sendo a protecao dessa
 * rota. Sem esta excecao o proxy redirecionava o cron para `/login` com 307 e
 * a checagem de `CRON_SECRET` nunca chegava a rodar.
 */
const ROTAS_COM_AUTENTICACAO_PROPRIA = ["/api/cron"];

/** Casa o caminho exato ou qualquer subcaminho dele ("/api/cron/x"). */
function casaPrefixo(pathname: string, prefixos: readonly string[]): boolean {
  return prefixos.some(
    (rota) => pathname === rota || pathname.startsWith(`${rota}/`),
  );
}

/** Caminhos em que a triagem de sessao do proxy nao deve rodar. */
export function dispensaSessao(pathname: string): boolean {
  return (
    casaPrefixo(pathname, ROTAS_PUBLICAS) ||
    casaPrefixo(pathname, ROTAS_COM_AUTENTICACAO_PROPRIA)
  );
}

type SessaoDoCookie = {
  usuarioId?: number;
  /**
   * Ausente em dois casos: cookie selado antes da Fase A (que ainda nao
   * gravava papel) e papel fora de `PAPEIS`. Ver `desviaPorPapel`.
   */
  papel?: PapelUsuario;
};

async function sessaoDoCookie(request: NextRequest): Promise<SessaoDoCookie> {
  const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (!cookie) {
    return {};
  }

  try {
    const sessao = await unsealData<SessionData>(cookie, {
      password: sessionSecret(),
      ttl: sessionTtlSeconds(),
    });

    return {
      usuarioId: sessao?.usuarioId,
      papel: ehPapelValido(sessao?.papel) ? sessao.papel : undefined,
    };
  } catch {
    // Cookie adulterado, expirado ou assinado com outro SESSION_SECRET.
    return {};
  }
}

/**
 * O proxy deve desviar esta requisicao por falta de permissao?
 *
 * Papel ausente no cookie **passa** — e esta e a unica decisao permissiva de
 * todo o controle de acesso. Ela e segura porque nao e a decisao final: quem
 * chega a pagina cai em `requireAcessoARota()` e quem chama a action cai em
 * `autorizarRota()`, e ambos leem o papel no banco. O ganho e nao expulsar de
 * "Nova requisição" e "Encaminhamentos" todo admin com sessao aberta desde
 * antes da Fase A — cujos cookies nao tem `papel` e so ganhariam um no proximo
 * login. Se em vez disso a ausencia fechasse a rota, o efeito do deploy seria
 * um admin legitimo sendo jogado no painel sem explicacao nenhuma.
 */
function desviaPorPapel(papel: PapelUsuario | undefined, pathname: string) {
  return papel !== undefined && !podeAcessarRota(papel, pathname);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (dispensaSessao(pathname)) {
    return NextResponse.next();
  }

  const { usuarioId, papel } = await sessaoDoCookie(request);

  if (!usuarioId) {
    const destino = new URL(
      urlDeLogin(`${pathname}${request.nextUrl.search}`),
      request.url,
    );

    return NextResponse.redirect(destino);
  }

  // O allowlist tambem bloqueia /sulamerica e todos os seus subcaminhos.
  // Autenticado, mas sem permissao para esta tela: o destino e o painel, nao o
  // login. Mandar para o login diria "identifique-se" a quem ja se identificou,
  // e o `next=` traria a pessoa de volta para a mesma parede.
  if (desviaPorPapel(papel, pathname)) {
    return NextResponse.redirect(new URL(ROTA_PADRAO_DA_RECEPCAO, request.url));
  }

  // Repassa o caminho pedido para o layout autenticado montar o `next=` certo.
  const headers = new Headers(request.headers);
  headers.set(PATHNAME_HEADER, `${pathname}${request.nextUrl.search}`);

  return NextResponse.next({ request: { headers } });
}

/**
 * `api/cron` tambem sai do `matcher`, para o proxy nem ser invocado nessas
 * rotas. E redundante com `ROTAS_COM_AUTENTICACAO_PROPRIA` de proposito: o
 * `matcher` e a barreira de producao, e a lista acima e o que mantem o
 * comportamento correto se o `matcher` mudar. `proxy.test.ts` afirma as duas,
 * justamente para as duas nao saírem de sincronia em silencio.
 */
export const config = {
  matcher: [
    // Tudo, menos as rotas de cron, os assets do Next e arquivos estaticos da
    // pasta public.
    "/((?!api/cron(?:/|$)|_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

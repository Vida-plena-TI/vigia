import { unsealData } from "iron-session";
import { NextResponse, type NextRequest } from "next/server";

import { urlDeLogin } from "@/lib/auth/next-path";
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

async function usuarioIdDaSessao(
  request: NextRequest,
): Promise<number | undefined> {
  const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (!cookie) {
    return undefined;
  }

  try {
    const sessao = await unsealData<SessionData>(cookie, {
      password: sessionSecret(),
      ttl: sessionTtlSeconds(),
    });

    return sessao?.usuarioId;
  } catch {
    // Cookie adulterado, expirado ou assinado com outro SESSION_SECRET.
    return undefined;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (dispensaSessao(pathname)) {
    return NextResponse.next();
  }

  const usuarioId = await usuarioIdDaSessao(request);

  if (!usuarioId) {
    const destino = new URL(
      urlDeLogin(`${pathname}${request.nextUrl.search}`),
      request.url,
    );

    return NextResponse.redirect(destino);
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

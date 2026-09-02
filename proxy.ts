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
const ROTAS_PUBLICAS = ["/login", "/api/auth"];

function ehRotaPublica(pathname: string): boolean {
  return ROTAS_PUBLICAS.some(
    (rota) => pathname === rota || pathname.startsWith(`${rota}/`),
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

  if (ehRotaPublica(pathname)) {
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

export const config = {
  matcher: [
    // Tudo, menos os assets do Next e arquivos estaticos da pasta public.
    "/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

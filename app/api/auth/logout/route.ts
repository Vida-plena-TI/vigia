import { getIronSession } from "iron-session";
import { NextResponse, type NextRequest } from "next/server";

import {
  getSessionOptions,
  type SessionData,
} from "@/lib/auth/session-options";
import { safeNextPath, urlDeLogin } from "@/lib/auth/next-path";

/**
 * Logout: apaga o cookie de sessao e manda para o login.
 *
 * E um route handler (e nao uma Server Action) porque tambem precisa ser
 * alcancavel por GET: um Server Component nao pode escrever cookies, entao
 * `requireUsuario` redireciona para ca quando a sessao aponta para um usuario
 * que nao existe mais ou foi desativado.
 */
async function encerrarSessao(request: NextRequest, next?: string | null) {
  const destino = next ? urlDeLogin(safeNextPath(next)) : "/login";

  // 303: transforma o POST do formulario em um GET na pagina de login.
  const response = NextResponse.redirect(new URL(destino, request.url), 303);

  // Escrevemos o Set-Cookie direto nesta resposta (e nao via `cookies()`) para
  // garantir que o cookie apagado acompanhe o redirect.
  const session = await getIronSession<SessionData>(
    request,
    response,
    getSessionOptions(),
  );
  session.destroy();

  return response;
}

/** Botao "Sair" do layout autenticado. */
export async function POST(request: NextRequest) {
  return encerrarSessao(request);
}

/** Sessao valida no cookie, mas usuario inexistente/inativo no banco. */
export async function GET(request: NextRequest) {
  return encerrarSessao(request, request.nextUrl.searchParams.get("next"));
}

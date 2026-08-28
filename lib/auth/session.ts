import "server-only";

import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";

/** Conteudo do cookie de sessao. Nao ha perfis: ou existe usuario logado, ou nao. */
export type SessionData = {
  userId?: number;
  username?: string;
};

const DEFAULT_TTL_HOURS = 8;

function sessionTtlSeconds(): number {
  const raw = process.env.SESSION_TTL_HOURS;
  const hours = raw ? Number(raw) : DEFAULT_TTL_HOURS;

  if (!Number.isFinite(hours) || hours <= 0) {
    return DEFAULT_TTL_HOURS * 60 * 60;
  }

  return Math.floor(hours * 60 * 60);
}

export function getSessionOptions(): SessionOptions {
  const password = process.env.SESSION_SECRET;

  if (!password || password.length < 32) {
    throw new Error(
      "SESSION_SECRET nao definida ou com menos de 32 caracteres. Veja .env.example.",
    );
  }

  return {
    password,
    cookieName: "klini_session",
    ttl: sessionTtlSeconds(),
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      // Cookie so exige HTTPS em producao, para nao quebrar o dev em http://localhost.
      secure: process.env.NODE_ENV === "production",
      maxAge: sessionTtlSeconds(),
    },
  };
}

/** Le (ou cria) a sessao a partir do cookie da requisicao atual. */
export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, getSessionOptions());
}

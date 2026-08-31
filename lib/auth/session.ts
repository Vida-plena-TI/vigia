import "server-only";

import { getIronSession } from "iron-session";
import { cookies } from "next/headers";

export {
  SESSION_COOKIE_NAME,
  getSessionOptions,
  sessionTtlSeconds,
  type SessionData,
} from "./session-options";

import { getSessionOptions, type SessionData } from "./session-options";

/** Le (ou cria) a sessao a partir do cookie da requisicao atual. */
export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, getSessionOptions());
}

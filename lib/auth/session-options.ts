/**
 * Configuracao do cookie de sessao (iron-session).
 *
 * Este modulo NAO importa `server-only` nem `next/headers` de proposito: ele e
 * lido tambem pelo `proxy.ts`, que roda fora do contexto de renderizacao. O
 * acesso a sessao a partir de um Server Component / Server Action fica em
 * `lib/auth/session.ts`.
 */
import type { SessionOptions } from "iron-session";

import type { PapelUsuario } from "./papel";

/**
 * Conteudo do cookie de sessao.
 *
 * Todos os campos sao opcionais porque a sessao vazia (visitante sem login) e
 * um estado valido: `usuarioId` ausente e o que significa "nao autenticado".
 *
 * **`papel` aqui nao e autorizacao.** A fonte de verdade continua sendo
 * `requireUsuario()`, que le o usuario no banco a cada requisicao e enxerga
 * conta desativada ou papel trocado depois que o cookie foi selado. O papel no
 * cookie existe para o `proxy.ts` — que roda antes de tudo e nao consulta o
 * banco — poder tomar decisoes baratas de UI/redirect sem uma ida ao Postgres
 * por requisicao. Na Fase A nada consome esse campo ainda; ele so passa a ser
 * lido na Fase C (controle de acesso).
 *
 * `username` acompanha `usuarioId` pelo mesmo motivo: e o que o proxy poderia
 * precisar exibir sem consulta. Ele tambem e uma copia, nao a verdade — quem
 * quiser o username correto usa `getUsuarioAtual()`.
 *
 * Como sao copias seladas no login, elas envelhecem: mudar o papel de alguem
 * no banco so aparece no cookie no proximo login. Por isso nenhuma decisao que
 * precise estar certa pode sair daqui.
 */
export type SessionData = {
  usuarioId?: number;
  username?: string;
  papel?: PapelUsuario;
};

export const SESSION_COOKIE_NAME = "klini_session";

const DEFAULT_TTL_HOURS = 8;

/** Duracao da sessao em segundos, configuravel por SESSION_TTL_HOURS. */
export function sessionTtlSeconds(): number {
  const raw = process.env.SESSION_TTL_HOURS;
  const hours = raw ? Number(raw) : DEFAULT_TTL_HOURS;

  if (!Number.isFinite(hours) || hours <= 0) {
    return DEFAULT_TTL_HOURS * 60 * 60;
  }

  return Math.floor(hours * 60 * 60);
}

/** Segredo usado para assinar/criptografar o cookie. */
export function sessionSecret(): string {
  const password = process.env.SESSION_SECRET;

  if (!password || password.length < 32) {
    throw new Error(
      "SESSION_SECRET nao definida ou com menos de 32 caracteres. Veja .env.example.",
    );
  }

  return password;
}

export function getSessionOptions(): SessionOptions {
  const ttl = sessionTtlSeconds();

  return {
    password: sessionSecret(),
    cookieName: SESSION_COOKIE_NAME,
    ttl,
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      // Cookie so exige HTTPS em producao, para nao quebrar o dev em http://localhost.
      secure: process.env.NODE_ENV === "production",
      maxAge: ttl,
    },
  };
}

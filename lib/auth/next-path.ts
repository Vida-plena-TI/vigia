/**
 * Validacao do parametro `next` usado no login.
 *
 * Regra de negocio 2 do CONTEXT.md: so aceitamos caminhos internos — precisa
 * comecar com "/" e nao pode comecar com "//" (que o navegador interpreta como
 * URL protocolo-relativa e levaria o usuario para outro dominio depois do
 * login).
 */

/** Devolve o caminho se for interno e seguro; senao, null. */
export function safeNextPath(
  next: string | null | undefined,
): string | null {
  if (!next || typeof next !== "string") {
    return null;
  }

  if (!next.startsWith("/")) {
    return null;
  }

  if (next.startsWith("//")) {
    return null;
  }

  // "/\evil.com" tambem e tratado como protocolo-relativo por varios
  // navegadores; o CONTEXT so cita "//", mas o buraco e o mesmo.
  if (next.startsWith("/\\")) {
    return null;
  }

  return next;
}

/** Monta a URL de login preservando o caminho de origem em `next`. */
export function urlDeLogin(next?: string | null): string {
  const destino = safeNextPath(next);

  return destino ? `/login?next=${encodeURIComponent(destino)}` : "/login";
}

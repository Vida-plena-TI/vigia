/**
 * Hash e verificacao de senha com bcrypt.
 *
 * Sem `server-only` de proposito: este modulo tambem e usado por
 * `scripts/create-admin.ts`, que roda fora do Next. `bcryptjs` e codigo de
 * servidor puro e nunca deve chegar a um Client Component.
 */
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

/**
 * Hash "descartavel" usado para gastar o mesmo tempo de CPU quando o usuario
 * nao existe. Sem isso, o tempo de resposta denunciaria se o username existe.
 */
const DUMMY_HASH =
  "$2b$12$C6UzMDM.H6dfI/f/IKcEe.9WgRYW6hCcGgXBmKl5c9MEr0LzZ7Nsu";

export async function hashPassword(senha: string): Promise<string> {
  return bcrypt.hash(senha, SALT_ROUNDS);
}

export async function verifyPassword(
  senha: string,
  hash: string,
): Promise<boolean> {
  if (!hash) {
    return false;
  }

  try {
    return await bcrypt.compare(senha, hash);
  } catch {
    // Hash malformado no banco: trata como senha invalida, nao como erro 500.
    return false;
  }
}

/** Gasta o tempo de um bcrypt.compare sem ter um hash real para comparar. */
export async function fakeVerifyPassword(senha: string): Promise<void> {
  await bcrypt.compare(senha, DUMMY_HASH);
}

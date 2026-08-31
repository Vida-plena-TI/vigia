"use server";

import { redirect } from "next/navigation";

import { prisma } from "@/lib/db";

import { safeNextPath } from "./next-path";
import { fakeVerifyPassword, verifyPassword } from "./password";
import { getSession } from "./session";

export type LoginState = {
  erro?: string;
  /** Preserva o que o usuario digitou para o campo nao voltar vazio. */
  username?: string;
};

/**
 * Mensagem unica para qualquer falha de login. Nao diferencia "usuario nao
 * existe", "usuario inativo" e "senha errada" — isso entregaria a um atacante
 * quais usernames existem no sistema.
 */
const ERRO_CREDENCIAIS = "Usuario ou senha invalidos.";

/**
 * Login (regra de negocio 1 do CONTEXT.md).
 *
 * Falha -> devolve o estado com a mensagem de erro, sem redirect: o formulario
 * e re-renderizado no lugar.
 * Sucesso -> grava `usuarioId` na sessao e redireciona para `next` (se for um
 * caminho interno) ou para "/".
 */
export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim();
  const senha = String(formData.get("password") ?? "");
  const destino = safeNextPath(String(formData.get("next") ?? "")) ?? "/";

  if (!username || !senha) {
    return { erro: ERRO_CREDENCIAIS, username };
  }

  const usuario = await prisma.usuario.findUnique({
    where: { username },
    select: { id: true, passwordHash: true, ativo: true },
  });

  if (!usuario || !usuario.ativo) {
    // Gasta o mesmo tempo de CPU do caminho feliz para nao vazar, pelo tempo de
    // resposta, se o username existe.
    await fakeVerifyPassword(senha);
    return { erro: ERRO_CREDENCIAIS, username };
  }

  const senhaOk = await verifyPassword(senha, usuario.passwordHash);

  if (!senhaOk) {
    return { erro: ERRO_CREDENCIAIS, username };
  }

  const session = await getSession();
  session.usuarioId = usuario.id;
  await session.save();

  // `redirect` lanca uma excecao de controle — precisa ficar fora de try/catch.
  redirect(destino);
}

"use server";

import { redirect } from "next/navigation";

import { getPrismaClient } from "@/lib/db";

import { ehPapelValido } from "./papel";
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
const ERRO_CREDENCIAIS = "Usuário ou senha inválidos.";

/**
 * Login (regra de negocio 1 do CONTEXT.md).
 *
 * Falha -> devolve o estado com a mensagem de erro, sem redirect: o formulario
 * e re-renderizado no lugar.
 * Sucesso -> grava `usuarioId`, `username` e `papel` na sessao e redireciona
 * para `next` (se for um caminho interno) ou para "/".
 *
 * O papel vai para o cookie para o `proxy.ts` poder decidir sem banco (ver
 * `SessionData`); ele nao substitui `requireUsuario()`, que continua sendo a
 * checagem que vale.
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

  const usuario = await getPrismaClient().usuario.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      passwordHash: true,
      ativo: true,
      papel: true,
    },
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
  session.username = usuario.username;
  // `papel` e `String` no Prisma (o conjunto de valores vive no CHECK da
  // tabela, nao no schema), entao a leitura passa pelo guarda antes de entrar
  // no cookie tipado. Um valor fora da lista deixa a sessao sem papel em vez de
  // gravar lixo selado — e como nada na Fase A le esse campo, isso nao muda o
  // login; na Fase C, "sem papel" e o caso restritivo, nao o permissivo.
  session.papel = ehPapelValido(usuario.papel) ? usuario.papel : undefined;
  await session.save();

  // `redirect` lanca uma excecao de controle — precisa ficar fora de try/catch.
  redirect(destino);
}

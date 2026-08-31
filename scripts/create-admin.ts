/**
 * Cria (ou atualiza) o usuario administrativo a partir do ambiente.
 *
 * Equivalente ao `create_admin_user.py` do sistema antigo. Se o username ja
 * existir, a senha e reescrita e o usuario e reativado — e assim que se
 * recupera o acesso depois de perder a senha.
 *
 *   ADMIN_USERNAME=admin ADMIN_PASSWORD=troque-isso npm run create-admin
 *
 * Usa DATABASE_URL (role de runtime): criar usuario e DML, nao precisa do role
 * de migrations.
 */
import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { hashPassword } from "../lib/auth/password";
import { PrismaClient } from "../lib/generated/prisma/client";

const MIN_SENHA = 8;

function lerEnv(nome: string): string {
  const valor = process.env[nome]?.trim();

  if (!valor) {
    throw new Error(
      `${nome} nao definida. Rode com ADMIN_USERNAME=... ADMIN_PASSWORD=... npm run create-admin`,
    );
  }

  return valor;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL nao definida. Copie .env.example para .env e preencha a string de conexao do Postgres.",
    );
  }

  const username = lerEnv("ADMIN_USERNAME");
  // A senha nao passa por trim: espaco pode ser parte dela.
  const senha = process.env.ADMIN_PASSWORD ?? "";

  if (senha.length < MIN_SENHA) {
    throw new Error(
      `ADMIN_PASSWORD nao definida ou com menos de ${MIN_SENHA} caracteres.`,
    );
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    const passwordHash = await hashPassword(senha);

    const existente = await prisma.usuario.findUnique({
      where: { username },
      select: { id: true },
    });

    const usuario = await prisma.usuario.upsert({
      where: { username },
      update: { passwordHash, ativo: true },
      create: { username, passwordHash, ativo: true },
      select: { id: true, username: true },
    });

    console.log(
      existente
        ? `Usuario "${usuario.username}" (id ${usuario.id}) atualizado: senha redefinida e conta ativada.`
        : `Usuario "${usuario.username}" (id ${usuario.id}) criado e ativo.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});

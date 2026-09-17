/**
 * Cria (ou atualiza) a conta da recepcao a partir do ambiente.
 *
 * Mesmo molde de `scripts/create-admin.ts` — idempotente: se o username ja
 * existir, a senha e reescrita e a conta e reativada, em vez de falhar por
 * duplicata. A implementacao das duas e a mesma funcao
 * (`criarOuAtualizarUsuario`); aqui muda o papel gravado e as variaveis lidas.
 *
 *   RECEPCAO_USERNAME=recepcao RECEPCAO_PASSWORD=troque-isso npm run create-recepcao
 *
 * As variaveis sao proprias de proposito: reaproveitar ADMIN_USERNAME /
 * ADMIN_PASSWORD deixaria ambiguo qual conta o comando esta criando ou
 * atualizando — e, como o papel e reescrito na atualizacao, uma confusao
 * dessas rebaixaria o admin a recepcao sem avisar.
 *
 * Usa DATABASE_URL (role de runtime): criar usuario e DML, nao precisa do role
 * de migrations.
 */
import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { criarOuAtualizarUsuario, MIN_SENHA } from "../lib/auth/criar-usuario";
import { PrismaClient } from "../lib/generated/prisma/client";

async function main() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL nao definida. Copie .env.example para .env e preencha a string de conexao do Postgres.",
    );
  }

  const username = process.env.RECEPCAO_USERNAME?.trim();

  if (!username) {
    throw new Error(
      "RECEPCAO_USERNAME nao definida. Rode com RECEPCAO_USERNAME=... RECEPCAO_PASSWORD=... npm run create-recepcao",
    );
  }

  // A senha nao passa por trim: espaco pode ser parte dela.
  const senha = process.env.RECEPCAO_PASSWORD ?? "";

  if (senha.length < MIN_SENHA) {
    throw new Error(
      `RECEPCAO_PASSWORD nao definida ou com menos de ${MIN_SENHA} caracteres.`,
    );
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    const conta = await criarOuAtualizarUsuario(prisma, {
      username,
      senha,
      papel: "recepcao",
    });

    console.log(
      conta.jaExistia
        ? `Usuario "${conta.username}" (id ${conta.id}) atualizado: senha redefinida, conta ativada e papel "${conta.papel}".`
        : `Usuario "${conta.username}" (id ${conta.id}) criado e ativo, com papel "${conta.papel}".`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});

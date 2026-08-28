import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Cliente Prisma singleton.
 *
 * Em desenvolvimento o Next.js reavalia os modulos a cada hot reload, o que
 * abriria um novo pool de conexoes a cada alteracao e esgotaria os slots do
 * Postgres. Guardamos a instancia no globalThis para reaproveita-la entre
 * reloads; em producao o modulo e avaliado uma unica vez.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL nao definida. Copie .env.example para .env e preencha a string de conexao do Postgres.",
    );
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

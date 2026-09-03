import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Cliente Prisma singleton, criado **na primeira consulta** e não no import.
 *
 * A checagem de `DATABASE_URL` e a abertura do pool moravam no topo do módulo,
 * de modo que só importar `@/lib/db` já podia estourar. Isso quebrava o
 * `next build` na fase de **"Collecting page data"**: essa fase carrega os
 * módulos de cada rota para ler a configuração deles (`revalidate`, `runtime`,
 * `dynamic`) e não executa consulta nenhuma — mas importar a rota importa a
 * cadeia inteira até aqui, e o `throw` do topo derrubava o build. O sintoma é
 * `Failed to collect page data for /api/cron/relatorio-semanal`, com a
 * mensagem de `DATABASE_URL` como `cause`.
 *
 * Isso acontece em qualquer ambiente que compile sem a variável — na prática o
 * **Preview da Vercel**, onde é comum a `DATABASE_URL` não estar configurada.
 * O build não precisa de banco; só o runtime precisa.
 *
 * Com a criação preguiçosa a falha passa a acontecer onde ela significa alguma
 * coisa: na primeira consulta de verdade, com a mensagem abaixo, e não no
 * `import`. Um ambiente mal configurado continua falhando — só que na
 * requisição, não no build.
 *
 * Consequência para quem escreve código novo: **não há mais um `prisma`
 * exportado**. Toda função de domínio e toda Server Action chama
 * `getPrismaClient()` dentro do corpo. Um `const prisma = getPrismaClient()`
 * no topo de um módulo reintroduziria exatamente o problema que isto resolve.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Memoização do processo.
 *
 * Em desenvolvimento o Next.js reavalia os módulos a cada hot reload, o que
 * abriria um pool novo a cada alteração e esgotaria os slots do Postgres; por
 * isso o cliente também é publicado no `globalThis`, que sobrevive ao reload.
 * Em produção o módulo é avaliado uma única vez e esta variável basta.
 */
let memoizado: PrismaClient | undefined;

function criarPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL não definida — o banco só é acessado em tempo de execução, " +
        "então esta mensagem significa que o ambiente que atendeu esta requisição " +
        "não tem a variável configurada. Em desenvolvimento: copie .env.example " +
        "para .env e preencha a string de conexão do Postgres. Na Vercel: " +
        "configure DATABASE_URL no ambiente correspondente (Production, Preview " +
        "ou Development).",
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

/**
 * O cliente Prisma da aplicação. Chamar de dentro da função que consulta.
 *
 * Barato de chamar quantas vezes for: a primeira chamada cria o cliente, as
 * seguintes devolvem o mesmo. É de propósito uma função e não uma constante
 * exportada — ver o comentário do topo do módulo.
 */
export function getPrismaClient(): PrismaClient {
  memoizado ??= globalForPrisma.prisma ?? criarPrismaClient();

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = memoizado;
  }

  return memoizado;
}

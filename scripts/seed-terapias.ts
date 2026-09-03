/**
 * Popula a tabela `terapia` com o catalogo real de terapias da clinica.
 *
 * E idempotente: a chave e o `nome` (unico no banco), entao rodar de novo
 * apenas reescreve o `codigo_tiss` de quem ja existe, sem duplicar nem apagar
 * terapias cadastradas a mao.
 *
 *   npm run seed:terapias
 *
 * Nao ha provedor hardcoded: o script usa a `DATABASE_URL` que estiver no
 * ambiente no momento da execucao. Rodar contra o Postgres local ou contra o
 * Supabase de producao e so uma questao de qual `DATABASE_URL` esta ativa na
 * sessao do terminal — ver "Primeiro deploy" no README.
 *
 * Usa `DATABASE_URL` (role de runtime): cadastrar terapia e DML, nao precisa do
 * role de migrations.
 */
import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../lib/generated/prisma/client";

/**
 * Catalogo fornecido pela clinica.
 *
 * `Psicomotricidade` e `Fisioterapia` compartilham o codigo `50000171` — o dado
 * e esse mesmo, nao e engano de digitacao. `codigo_tiss` nao e unico no banco,
 * entao as duas convivem sem conflito. Nao "corrigir".
 */
const TERAPIAS: { nome: string; codigoTiss: string }[] = [
  { nome: "Psicomotricidade", codigoTiss: "50000171" },
  { nome: "Psicologia", codigoTiss: "50000005" },
  { nome: "Terapia Ocupacional", codigoTiss: "50100080" },
  { nome: "Musicoterapia", codigoTiss: "50000113" },
  { nome: "Terapia Alimentar", codigoTiss: "50100060" },
  { nome: "Fisioterapia", codigoTiss: "50000171" },
  { nome: "Fonoaudiologia", codigoTiss: "50000006" },
  { nome: "Psicopedagogia", codigoTiss: "50000023" },
];

async function main() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL nao definida. Copie .env.example para .env e preencha a string de conexao do Postgres.",
    );
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    let criadas = 0;
    let atualizadas = 0;

    for (const { nome, codigoTiss } of TERAPIAS) {
      const existente = await prisma.terapia.findUnique({
        where: { nome },
        select: { id: true, codigoTiss: true },
      });

      const terapia = await prisma.terapia.upsert({
        where: { nome },
        update: { codigoTiss },
        create: { nome, codigoTiss },
        select: { id: true, nome: true, codigoTiss: true },
      });

      if (!existente) {
        criadas += 1;
        console.log(
          `Terapia "${terapia.nome}" (id ${terapia.id}) criada com codigo ${terapia.codigoTiss}.`,
        );
        continue;
      }

      atualizadas += 1;
      console.log(
        existente.codigoTiss === codigoTiss
          ? `Terapia "${terapia.nome}" (id ${terapia.id}) ja estava correta.`
          : `Terapia "${terapia.nome}" (id ${terapia.id}): codigo ${existente.codigoTiss} -> ${terapia.codigoTiss}.`,
      );
    }

    console.log(
      `\n${TERAPIAS.length} terapias no catalogo: ${criadas} criada(s), ${atualizadas} ja existente(s).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});

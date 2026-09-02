/**
 * Seed de desenvolvimento.
 *
 * Popula o banco com um usuario, tres terapias e tres pacientes cujas guias
 * cobrem os tres valores de `status_alerta` da view `requisicao_terapia_saldo`:
 * "Regular", "Renovar" e "Esgotada".
 *
 * E idempotente: pode rodar quantas vezes quiser sem duplicar nada e sem
 * apagar dados criados na mao.
 *
 *   npx prisma db seed
 */
import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

import { PrismaClient } from "../lib/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL nao definida. Copie .env.example para .env e preencha a string de conexao do Postgres.",
  );
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

/** Data de hoje truncada — as colunas DATE nao carregam hora. */
function hoje(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Hoje + n dias (n negativo = passado). */
function emDias(n: number): Date {
  const d = hoje();
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

/**
 * Get-or-create de paciente por nome, case-insensitive e com trim — a mesma
 * regra do banco (`UNIQUE (lower(nome))`) e do fluxo de criar requisicao.
 */
async function getOrCreatePaciente(nomeBruto: string) {
  const nome = nomeBruto.trim();

  const existente = await prisma.paciente.findFirst({
    where: { nome: { equals: nome, mode: "insensitive" } },
  });

  return existente ?? prisma.paciente.create({ data: { nome } });
}

type GuiaSeed = {
  terapia: string;
  qtdAutorizada: number;
  validade: Date | null;
  /** Creditos ja lancados, um atendimento por entrada. */
  atendimentos: number[];
};

type RequisicaoSeed = {
  paciente: string;
  numeroRequisicao: string;
  guias: GuiaSeed[];
};

const TERAPIAS: { nome: string; codigoTiss: string }[] = [
  { nome: "Fonoaudiologia", codigoTiss: "50000470" },
  { nome: "Terapia Ocupacional", codigoTiss: "50000560" },
  { nome: "Psicologia", codigoTiss: "50000586" },
];

const REQUISICOES: RequisicaoSeed[] = [
  {
    // Guias saudaveis: sobra saldo e a validade esta longe -> "Regular".
    paciente: "Ana Beatriz Moraes",
    numeroRequisicao: "2026-0001",
    guias: [
      {
        terapia: "Fonoaudiologia",
        qtdAutorizada: 40,
        validade: emDias(90),
        atendimentos: [1, 1, 2],
      },
      {
        terapia: "Psicologia",
        qtdAutorizada: 24,
        validade: emDias(90),
        atendimentos: [1, 1],
      },
    ],
  },
  {
    // Uma guia perto do fim do saldo e outra vencendo em 5 dias -> "Renovar".
    paciente: "Carlos Eduardo Lima",
    numeroRequisicao: "2026-0002",
    guias: [
      {
        terapia: "Terapia Ocupacional",
        // 16 autorizados, 13 usados: saldo 3 <= 16/4 -> Renovar por saldo.
        qtdAutorizada: 16,
        validade: emDias(60),
        atendimentos: [4, 4, 3, 2],
      },
      {
        terapia: "Fonoaudiologia",
        // Saldo folgado, mas validade a 5 dias -> Renovar por validade.
        qtdAutorizada: 32,
        validade: emDias(5),
        atendimentos: [1, 1],
      },
    ],
  },
  {
    // Saldo zerado -> "Esgotada"; a segunda guia fica "Regular".
    paciente: "Mariana Souza Ribeiro",
    numeroRequisicao: "2026-0003",
    guias: [
      {
        terapia: "Psicologia",
        qtdAutorizada: 12,
        validade: null,
        atendimentos: [4, 4, 4],
      },
      {
        terapia: "Terapia Ocupacional",
        qtdAutorizada: 20,
        validade: emDias(45),
        atendimentos: [2],
      },
    ],
  },
];

async function main() {
  // --- usuario ------------------------------------------------------------
  const usuario = await prisma.usuario.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      username: "admin",
      passwordHash: bcrypt.hashSync("admin123", 10),
      ativo: true,
    },
  });

  // --- terapias -----------------------------------------------------------
  const terapias = new Map<string, number>();

  for (const t of TERAPIAS) {
    const terapia = await prisma.terapia.upsert({
      where: { nome: t.nome },
      update: { codigoTiss: t.codigoTiss },
      create: t,
    });
    terapias.set(terapia.nome, terapia.id);
  }

  // --- pacientes, requisicoes, guias e atendimentos ------------------------
  for (const r of REQUISICOES) {
    const paciente = await getOrCreatePaciente(r.paciente);

    const requisicao = await prisma.requisicao.upsert({
      where: {
        pacienteId_numeroRequisicao: {
          pacienteId: paciente.id,
          numeroRequisicao: r.numeroRequisicao,
        },
      },
      update: {},
      create: {
        numeroRequisicao: r.numeroRequisicao,
        pacienteId: paciente.id,
      },
    });

    for (const g of r.guias) {
      const terapiaId = terapias.get(g.terapia);

      if (terapiaId === undefined) {
        throw new Error(`Terapia "${g.terapia}" nao esta em TERAPIAS.`);
      }

      // Guia nao tem unique natural no schema, entao o get-or-create e por
      // (requisicao, terapia) — o par que o formulario nunca repete.
      const guia =
        (await prisma.requisicaoTerapia.findFirst({
          where: { requisicaoId: requisicao.id, terapiaId },
        })) ??
        (await prisma.requisicaoTerapia.create({
          data: {
            requisicaoId: requisicao.id,
            terapiaId,
            qtdAutorizada: g.qtdAutorizada,
            validade: g.validade,
          },
        }));

      // So lanca atendimentos se a guia ainda nao tiver nenhum, senao rodar o
      // seed de novo estouraria o saldo.
      const jaTemAtendimento = await prisma.atendimento.count({
        where: { requisicaoTerapiaId: guia.id },
      });

      if (jaTemAtendimento > 0) continue;

      await prisma.atendimento.createMany({
        data: g.atendimentos.map((creditos, i) => ({
          requisicaoTerapiaId: guia.id,
          dataAtendimento: emDias(-(g.atendimentos.length - i) * 7),
          creditosConsumidos: creditos,
          observacao: i === 0 ? "Sessao inicial (seed)" : null,
        })),
      });
    }
  }

  // --- resumo, lido da view -----------------------------------------------
  const saldos = await prisma.$queryRaw<
    {
      paciente: string;
      numero_requisicao: string;
      terapia: string;
      qtd_autorizada: number;
      qtd_utilizada: number;
      saldo_restante: number;
      creditos_por_sessao: string;
      status_alerta: string;
    }[]
  >`
    SELECT p."nome"                      AS paciente,
           r."numero_requisicao",
           t."nome"                      AS terapia,
           s."qtd_autorizada",
           s."qtd_utilizada",
           s."saldo_restante",
           s."creditos_por_sessao"::text AS creditos_por_sessao,
           s."status_alerta"
    FROM "requisicao_terapia_saldo" s
    JOIN "requisicao_terapia" rt ON rt."id" = s."id"
    JOIN "requisicao" r          ON r."id" = rt."requisicao_id"
    JOIN "paciente" p            ON p."id" = r."paciente_id"
    JOIN "terapia" t             ON t."id" = rt."terapia_id"
    ORDER BY p."nome", t."nome"
  `;

  console.log(`Usuario de teste: ${usuario.username} / admin123`);
  console.table(saldos);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

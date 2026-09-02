/**
 * Teste de integracao: a view SQL `requisicao_terapia_saldo` e o espelho em
 * TypeScript (`lib/domain/saldo.ts`) precisam calcular exatamente a mesma coisa.
 *
 * A view e a fonte de verdade em producao; este teste e o que impede as duas
 * implementacoes de divergirem em silencio quando uma das duas for alterada.
 *
 * Como roda:
 *   - precisa de DATABASE_URL apontando para um Postgres com as migrations
 *     aplicadas (`npm run db:migrate:dev`). Sem DATABASE_URL o bloco e pulado
 *     em vez de falhar, para `npm test` continuar util em CI sem banco;
 *   - tudo acontece dentro de uma transacao que sempre sofre rollback, entao o
 *     banco de desenvolvimento nao fica com lixo (nem os dados do seed mudam);
 *   - a data de referencia e o `CURRENT_DATE` do proprio banco, nao o relogio
 *     do Node — sem isso as bordas de validade (+7 / +8 dias) ficariam
 *     dependentes do fuso da maquina que roda o teste.
 */
import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";

import { calcularSaldo, qtdUtilizada, type StatusAlerta } from "./saldo";

const temBanco = Boolean(process.env.DATABASE_URL);

/** Uma linha da view, com numeric lido como texto (sem coercao do driver). */
type LinhaDaView = {
  id: number;
  qtdUtilizada: number;
  saldoRestante: number;
  creditosPorSessao: string;
  statusAlerta: string;
};

/** Erro sentinela: rola a transacao de volta depois de coletar os resultados. */
class Rollback extends Error {
  constructor(readonly dados: LinhaDaView[]) {
    super("rollback proposital do teste de integracao");
  }
}

/** Um cenario: a guia que sera inserida e o status que ela deve produzir. */
type Cenario = {
  nome: string;
  qtdAutorizada: number;
  /** Creditos de cada atendimento a lancar na guia. */
  atendimentos: number[];
  /** Dias a partir do CURRENT_DATE do banco; `null` = guia sem validade. */
  validadeEmDias: number | null;
  esperado: StatusAlerta;
};

/**
 * Cenarios de borda. `qtd_autorizada` nunca e 0/nulo aqui porque o banco
 * proibe (CHECK `requisicao_terapia_qtd_autorizada_positiva`) — esse caso e
 * coberto so no teste unitario, e o segundo `it` deste arquivo confirma que a
 * constraint existe.
 */
const CENARIOS: Cenario[] = [
  {
    nome: "guia nova, sem nenhum atendimento (LEFT JOIN da view)",
    qtdAutorizada: 12,
    atendimentos: [],
    validadeEmDias: null,
    esperado: "Regular",
  },
  {
    nome: "saldo confortavel e validade distante",
    qtdAutorizada: 20,
    atendimentos: [1, 2],
    validadeEmDias: 30,
    esperado: "Regular",
  },
  {
    nome: "saldo exatamente no limite de 25%",
    qtdAutorizada: 20,
    atendimentos: [10, 4, 1],
    validadeEmDias: null,
    esperado: "Renovar",
  },
  {
    nome: "saldo um credito acima do limite de 25%",
    qtdAutorizada: 20,
    atendimentos: [10, 4],
    validadeEmDias: null,
    esperado: "Regular",
  },
  {
    nome: "limiar fracionario (10 / 4 = 2.5, nao 2)",
    qtdAutorizada: 10,
    atendimentos: [8],
    validadeEmDias: null,
    esperado: "Renovar",
  },
  {
    nome: "validade exatamente em 7 dias",
    qtdAutorizada: 20,
    atendimentos: [],
    validadeEmDias: 7,
    esperado: "Renovar",
  },
  {
    nome: "validade em 8 dias",
    qtdAutorizada: 20,
    atendimentos: [],
    validadeEmDias: 8,
    esperado: "Regular",
  },
  {
    nome: "validade hoje",
    qtdAutorizada: 20,
    atendimentos: [],
    validadeEmDias: 0,
    esperado: "Renovar",
  },
  {
    nome: "validade ja vencida",
    qtdAutorizada: 20,
    atendimentos: [],
    validadeEmDias: -3,
    esperado: "Renovar",
  },
  {
    nome: "validade nula com saldo baixo (renova pelo saldo)",
    qtdAutorizada: 20,
    atendimentos: [16],
    validadeEmDias: null,
    esperado: "Renovar",
  },
  {
    nome: "saldo exatamente zerado",
    qtdAutorizada: 8,
    atendimentos: [5, 3],
    validadeEmDias: null,
    esperado: "Esgotada",
  },
  {
    nome: "saldo negativo",
    qtdAutorizada: 8,
    atendimentos: [5, 5],
    validadeEmDias: null,
    esperado: "Esgotada",
  },
  {
    nome: "esgotada tem precedencia sobre renovar por validade",
    qtdAutorizada: 8,
    atendimentos: [8],
    validadeEmDias: 1,
    esperado: "Esgotada",
  },
  {
    nome: "atendimento de 0 credito nao consome saldo",
    qtdAutorizada: 20,
    atendimentos: [0, 0, 1],
    validadeEmDias: null,
    esperado: "Regular",
  },
];

/** Sufixo unico para nao colidir com paciente/terapia ja existentes no banco. */
const SUFIXO = Math.random().toString(36).slice(2, 10);

/** CURRENT_DATE do banco + n dias, como Date de meia-noite UTC. */
function emDias(hoje: Date, n: number): Date {
  const d = new Date(hoje);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

/**
 * Monta os cenarios no banco, le a view e desfaz tudo.
 *
 * Ler dentro da transacao e obrigatorio: as guias so existem ali, e somem no
 * rollback.
 */
async function lerViewParaOsCenarios(): Promise<{
  hoje: Date;
  linhas: LinhaDaView[];
}> {
  let hoje: Date | undefined;

  try {
    await prisma.$transaction(
      async (tx) => {
        const [linhaHoje] = await tx.$queryRaw<{ hoje: string }[]>`
          SELECT CURRENT_DATE::text AS "hoje"
        `;
        const hojeDoBanco = new Date(`${linhaHoje.hoje}T00:00:00.000Z`);
        hoje = hojeDoBanco;

        const paciente = await tx.paciente.create({
          data: { nome: `Paciente Teste Saldo ${SUFIXO}` },
        });

        const requisicao = await tx.requisicao.create({
          data: { numeroRequisicao: `REQ-${SUFIXO}`, pacienteId: paciente.id },
        });

        for (const [indice, cenario] of CENARIOS.entries()) {
          const terapia = await tx.terapia.create({
            data: {
              nome: `Terapia Teste ${SUFIXO} ${indice}`,
              codigoTiss: `T${indice}`,
            },
          });

          await tx.requisicaoTerapia.create({
            data: {
              requisicaoId: requisicao.id,
              terapiaId: terapia.id,
              qtdAutorizada: cenario.qtdAutorizada,
              validade:
                cenario.validadeEmDias === null
                  ? null
                  : emDias(hojeDoBanco, cenario.validadeEmDias),
              atendimentos: {
                create: cenario.atendimentos.map((creditos) => ({
                  dataAtendimento: hojeDoBanco,
                  creditosConsumidos: creditos,
                })),
              },
            },
          });
        }

        // `creditos_por_sessao` vira texto de proposito: assim o driver nao
        // arredonda o numeric antes de a gente comparar.
        const linhas = await tx.$queryRaw<LinhaDaView[]>`
          SELECT "id",
                 "qtd_utilizada"             AS "qtdUtilizada",
                 "saldo_restante"            AS "saldoRestante",
                 "creditos_por_sessao"::text AS "creditosPorSessao",
                 "status_alerta"             AS "statusAlerta"
          FROM "requisicao_terapia_saldo"
          WHERE "requisicao_id" = ${requisicao.id}
          ORDER BY "id"
        `;

        throw new Rollback(linhas);
      },
      // `maxWait` é o tempo para *conseguir* a transação, e o padrão (2s) não
      // cobre a primeira, que ainda paga o custo de abrir a conexão contra o
      // banco remoto.
      { maxWait: 30_000, timeout: 30_000 },
    );
  } catch (erro) {
    if (erro instanceof Rollback && hoje) {
      return { hoje, linhas: erro.dados };
    }
    throw erro;
  }

  throw new Error("a transacao deveria ter sofrido rollback");
}

describe.skipIf(!temBanco)(
  "view requisicao_terapia_saldo x lib/domain/saldo.ts",
  () => {
    afterAll(async () => {
      await prisma.$disconnect();
    });

    it("calcula os quatro campos igual ao espelho em TypeScript", async () => {
      const { hoje, linhas } = await lerViewParaOsCenarios();

      expect(linhas).toHaveLength(CENARIOS.length);

      for (const [indice, cenario] of CENARIOS.entries()) {
        // As guias foram criadas na ordem dos cenarios e a query ordena por id.
        const linha = linhas[indice];

        const esperado = calcularSaldo(
          {
            qtdAutorizada: cenario.qtdAutorizada,
            qtdUtilizada: qtdUtilizada(cenario.atendimentos),
            validade:
              cenario.validadeEmDias === null
                ? null
                : emDias(hoje, cenario.validadeEmDias),
          },
          hoje,
        );

        const daView = {
          qtdUtilizada: Number(linha.qtdUtilizada),
          saldoRestante: Number(linha.saldoRestante),
          creditosPorSessao: Number(linha.creditosPorSessao),
          statusAlerta: linha.statusAlerta,
        };

        expect(daView, `view divergiu do TS no cenario: ${cenario.nome}`).toEqual(
          esperado,
        );

        // Guarda contra os dois lados errarem junto: o status tambem tem de
        // bater com o que o cenario declara.
        expect(
          esperado.statusAlerta,
          `TS divergiu do cenario esperado: ${cenario.nome}`,
        ).toBe(cenario.esperado);
      }
    }, 30_000);

    it("o banco proibe qtd_autorizada = 0 (o ramo vazio/0 do TS e so defensivo)", async () => {
      await expect(
        prisma.$transaction(
          async (tx) => {
            const paciente = await tx.paciente.create({
              data: { nome: `Paciente Check ${SUFIXO}` },
            });
            const requisicao = await tx.requisicao.create({
              data: {
                numeroRequisicao: `CHK-${SUFIXO}`,
                pacienteId: paciente.id,
              },
            });
            const terapia = await tx.terapia.create({
              data: { nome: `Terapia Check ${SUFIXO}`, codigoTiss: "CHK" },
            });

            await tx.requisicaoTerapia.create({
              data: {
                requisicaoId: requisicao.id,
                terapiaId: terapia.id,
                qtdAutorizada: 0,
                validade: null,
              },
            });
          },
          { maxWait: 30_000, timeout: 30_000 },
        ),
      ).rejects.toThrow(/qtd_autorizada_positiva/);
    });
  },
);

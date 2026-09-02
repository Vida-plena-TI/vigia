/**
 * Contraparte de `guias.test.ts` contra o Postgres real.
 *
 * O teste unitário prova que o nosso código decide certo a partir do
 * `status_alerta`; este prova que o status vem mesmo da view e que a regra 9
 * do CONTEXT.md sobrevive ao caminho completo (view -> decisão -> DELETE),
 * incluindo o cascade da regra 10.
 *
 * Como roda (mesmo contrato de `saldo.integration.test.ts`):
 *   - precisa de DATABASE_URL com as migrations aplicadas; sem ela o bloco é
 *     pulado em vez de falhar;
 *   - tudo acontece dentro de uma transação que sempre sofre rollback, então o
 *     banco de desenvolvimento não fica com lixo.
 */
import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";

import { ERRO_GUIA_REGULAR, excluirGuiaNaTransacao } from "./guias";

const temBanco = Boolean(process.env.DATABASE_URL);

/** Sufixo único para não colidir com paciente/terapia já existentes. */
const SUFIXO = Math.random().toString(36).slice(2, 10);

/** Erro sentinela: rola a transação de volta depois de coletar o resultado. */
class Rollback<T> extends Error {
  constructor(readonly dados: T) {
    super("rollback proposital do teste de integracao");
  }
}

/** Uma guia recém-criada, com o status que a view atribuiu a ela. */
type GuiaCriada = {
  id: number;
  statusAlerta: string;
};

type ClienteDaTransacao = Parameters<
  Parameters<typeof prisma.$transaction>[0]
>[0];

/**
 * Roda `executar` numa transação e desfaz tudo, devolvendo o que ela produziu.
 */
async function comRollback<T>(
  executar: (tx: ClienteDaTransacao) => Promise<T>,
): Promise<T> {
  try {
    await prisma.$transaction(
      async (tx) => {
        throw new Rollback(await executar(tx));
      },
      // `maxWait` é o tempo para *conseguir* a transação, e o padrão (2s) não
      // cobre a primeira, que ainda paga o custo de abrir a conexão contra o
      // banco remoto.
      { maxWait: 30_000, timeout: 30_000 },
    );
  } catch (erro) {
    if (erro instanceof Rollback) {
      return erro.dados as T;
    }
    throw erro;
  }

  throw new Error("a transacao deveria ter sofrido rollback");
}

/**
 * Cria paciente + requisição + terapia + guia e devolve a guia com o status
 * que a view calculou para ela.
 */
async function criarGuia(
  tx: ClienteDaTransacao,
  rotulo: string,
  qtdAutorizada: number,
  creditosDosAtendimentos: number[],
): Promise<GuiaCriada> {
  const paciente = await tx.paciente.create({
    data: { nome: `Paciente Exclusao ${rotulo} ${SUFIXO}` },
  });

  const requisicao = await tx.requisicao.create({
    data: {
      numeroRequisicao: `EXC-${rotulo}-${SUFIXO}`,
      pacienteId: paciente.id,
    },
  });

  const terapia = await tx.terapia.create({
    data: {
      nome: `Terapia Exclusao ${rotulo} ${SUFIXO}`,
      codigoTiss: `E${rotulo}`,
    },
  });

  const guia = await tx.requisicaoTerapia.create({
    data: {
      requisicaoId: requisicao.id,
      terapiaId: terapia.id,
      qtdAutorizada,
      atendimentos: {
        create: creditosDosAtendimentos.map((creditos) => ({
          // A data não influencia saldo nem status; só precisa ser válida.
          dataAtendimento: new Date("2026-01-15T00:00:00.000Z"),
          creditosConsumidos: creditos,
        })),
      },
    },
  });

  const [linha] = await tx.$queryRaw<{ statusAlerta: string }[]>`
    SELECT "status_alerta" AS "statusAlerta"
    FROM "requisicao_terapia_saldo"
    WHERE "id" = ${guia.id}
  `;

  return { id: guia.id, statusAlerta: linha.statusAlerta };
}

describe.skipIf(!temBanco)("exclusao de guia contra o banco real", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("recusa apagar uma guia Regular e deixa a linha no banco", async () => {
    const resultado = await comRollback(async (tx) => {
      // 20 autorizados, 2 consumidos, sem validade: sobra muito -> Regular.
      const guia = await criarGuia(tx, "regular", 20, [2]);

      const exclusao = await excluirGuiaNaTransacao(tx, guia.id);

      const aindaExiste = await tx.requisicaoTerapia.findUnique({
        where: { id: guia.id },
        select: { id: true },
      });

      return { guia, exclusao, aindaExiste };
    });

    expect(resultado.guia.statusAlerta).toBe("Regular");
    expect(resultado.exclusao).toEqual({ ok: false, erro: ERRO_GUIA_REGULAR });
    expect(resultado.aindaExiste).not.toBeNull();
  });

  it("apaga uma guia Esgotada junto com os atendimentos (cascade)", async () => {
    const resultado = await comRollback(async (tx) => {
      // 8 autorizados, 8 consumidos: saldo zerado -> Esgotada.
      const guia = await criarGuia(tx, "esgotada", 8, [5, 3]);

      const exclusao = await excluirGuiaNaTransacao(tx, guia.id);

      const aindaExiste = await tx.requisicaoTerapia.findUnique({
        where: { id: guia.id },
        select: { id: true },
      });

      const atendimentosOrfaos = await tx.atendimento.count({
        where: { requisicaoTerapiaId: guia.id },
      });

      return { guia, exclusao, aindaExiste, atendimentosOrfaos };
    });

    expect(resultado.guia.statusAlerta).toBe("Esgotada");
    expect(resultado.exclusao).toEqual({ ok: true });
    expect(resultado.aindaExiste).toBeNull();
    expect(resultado.atendimentosOrfaos).toBe(0);
  });

  it("apaga uma guia Renovar", async () => {
    const resultado = await comRollback(async (tx) => {
      // 20 autorizados, 16 consumidos: saldo 4 = 25% -> Renovar.
      const guia = await criarGuia(tx, "renovar", 20, [16]);

      const exclusao = await excluirGuiaNaTransacao(tx, guia.id);

      const aindaExiste = await tx.requisicaoTerapia.findUnique({
        where: { id: guia.id },
        select: { id: true },
      });

      return { guia, exclusao, aindaExiste };
    });

    expect(resultado.guia.statusAlerta).toBe("Renovar");
    expect(resultado.exclusao).toEqual({ ok: true });
    expect(resultado.aindaExiste).toBeNull();
  });
});

/**
 * Contraparte de `guias.test.ts` contra o Postgres real.
 *
 * O teste unitário prova a decisão do nosso código com o banco dublado; este
 * prova que a exclusão sobrevive ao caminho completo contra o Postgres, em
 * qualquer status — a regra 9 do CONTEXT.md, que recusava "Regular", foi
 * revertida por decisão do usuário —, incluindo o cascade da regra 10.
 *
 * Os três casos criam guias em status diferentes (lido da view, para o teste
 * provar que o status é o que se pensa) e exigem o mesmo desfecho: guia
 * apagada e atendimentos filhos junto.
 *
 * Como roda (mesmo contrato de `saldo.integration.test.ts`):
 *   - precisa de DATABASE_URL com as migrations aplicadas; sem ela o bloco é
 *     pulado em vez de falhar;
 *   - tudo acontece dentro de uma transação que sempre sofre rollback, então o
 *     banco de desenvolvimento não fica com lixo.
 */
import { afterAll, describe, expect, it } from "vitest";

import { getPrismaClient } from "@/lib/db";

import { ERRO_GUIA_INEXISTENTE, excluirGuiaNaTransacao } from "./guias";

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
  Parameters<ReturnType<typeof getPrismaClient>["$transaction"]>[0]
>[0];

/**
 * Roda `executar` numa transação e desfaz tudo, devolvendo o que ela produziu.
 */
async function comRollback<T>(
  executar: (tx: ClienteDaTransacao) => Promise<T>,
): Promise<T> {
  try {
    await getPrismaClient().$transaction(
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
    await getPrismaClient().$disconnect();
  });

  /**
   * Cada caso descreve uma guia por saldo e o status que a view tem de dar a
   * ela; o desfecho esperado é o mesmo nos três.
   */
  const CASOS = [
    {
      // 20 autorizados, 2 consumidos, sem validade: sobra muito -> Regular.
      status: "Regular",
      rotulo: "regular",
      qtdAutorizada: 20,
      creditos: [2],
    },
    {
      // 20 autorizados, 16 consumidos: saldo 4 = 25% -> Renovar.
      status: "Renovar",
      rotulo: "renovar",
      qtdAutorizada: 20,
      creditos: [16],
    },
    {
      // 8 autorizados, 8 consumidos: saldo zerado -> Esgotada.
      status: "Esgotada",
      rotulo: "esgotada",
      qtdAutorizada: 8,
      creditos: [5, 3],
    },
  ] as const;

  it.each(CASOS)(
    "apaga uma guia $status junto com os atendimentos (cascade)",
    async ({ status, rotulo, qtdAutorizada, creditos }) => {
      const resultado = await comRollback(async (tx) => {
        const guia = await criarGuia(tx, rotulo, qtdAutorizada, [...creditos]);

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

      // O status é lido da view: se a fórmula mudar, o caso falha aqui em vez
      // de passar testando outra coisa.
      expect(resultado.guia.statusAlerta).toBe(status);
      expect(resultado.exclusao).toEqual({ ok: true });
      expect(resultado.aindaExiste).toBeNull();
      expect(resultado.atendimentosOrfaos).toBe(0);
    },
  );

  /**
   * O `SELECT ... FOR UPDATE` da exclusão é o que descobre que a guia não
   * existe — não há mais nenhuma outra consulta antes do DELETE. Este caso
   * cobre o caminho contra o Postgres real: se aquele SQL deixasse de rodar,
   * o DELETE do Prisma estouraria em vez de devolver o erro tratado.
   *
   * A exclusividade do travamento em si não dá para observar daqui: tudo
   * acontece numa transação que sofre rollback, então uma segunda conexão nem
   * enxergaria a guia para disputar a trava. Quem guarda a ordem (travar antes
   * de apagar) é o teste unitário.
   */
  it("recusa uma guia que não existe, pelo FOR UPDATE", async () => {
    const exclusao = await comRollback(async (tx) => {
      const guia = await criarGuia(tx, "sumida", 20, [2]);

      await tx.requisicaoTerapia.delete({ where: { id: guia.id } });

      return excluirGuiaNaTransacao(tx, guia.id);
    });

    expect(exclusao).toEqual({ ok: false, erro: ERRO_GUIA_INEXISTENTE });
  });
});

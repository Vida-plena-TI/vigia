/**
 * Caixinha "Substituir guias da mesma terapia" contra o Postgres real.
 *
 * O que está sob teste é o que só o banco responde: que a guia antiga some
 * com os atendimentos (o `ON DELETE CASCADE`), que a requisição antiga que
 * fica vazia some junto e a que ainda tem guia fica, que nada de outro
 * paciente nem da própria pasta do envio é tocado, que a prévia diz
 * exatamente o que a transação apaga, que uma falha depois da exclusão desfaz
 * a exclusão, e que um lançamento de atendimento simultâneo termina em estado
 * consistente.
 *
 * Como roda (mesmo contrato dos outros `*.integration.test.ts`):
 *   - precisa de DATABASE_URL; sem ela o arquivo é pulado;
 *   - o que dá para provar dentro de uma transação roda em rollback;
 *   - atomicidade e corrida precisam de commit de verdade (uma transação tem
 *     de enxergar o commit da outra) e limpam no `finally`/`afterAll`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getPrismaClient } from "@/lib/db";

import {
  ERRO_GUIA_INEXISTENTE,
  lancarLote,
  lancarLoteNaTransacao,
  type ResultadoDoLote,
} from "./atendimentos";
import { cadastrarPacienteDeTeste } from "@/test/paciente-cadastrado";
import { registrarEncaminhamentoNaTransacao } from "./encaminhamentos";
import { excluirPacientePeloId } from "./pacientes";
import {
  criarRequisicao,
  criarRequisicaoNaTransacao,
  previsaoDeSubstituicaoComCliente,
  type EntradaNovaRequisicao,
  type ResultadoCriacao,
} from "./requisicoes";

const temBanco = Boolean(process.env.DATABASE_URL);

/** Sufixo único para não colidir com dados já existentes no banco de dev. */
const SUFIXO = Math.random().toString(36).slice(2, 10);

const DATA = "2026-01-15";

function carteirinhaDeTeste(): string {
  return `T${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

type ClienteDaTransacao = Parameters<
  Parameters<ReturnType<typeof getPrismaClient>["$transaction"]>[0]
>[0];

/** Erro sentinela: rola a transação de volta depois de coletar o resultado. */
class Rollback<T> extends Error {
  constructor(readonly dados: T) {
    super("rollback proposital do teste de integracao");
  }
}

async function comRollback<T>(
  executar: (tx: ClienteDaTransacao) => Promise<T>,
): Promise<T> {
  try {
    await getPrismaClient().$transaction(
      async (tx) => {
        throw new Rollback(await executar(tx));
      },
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

/** Um paciente com encaminhamento, pelo único caminho que cria paciente. */
async function pacienteComEncaminhamento(
  cliente: ClienteDaTransacao,
  rotulo: string,
): Promise<{ id: number; nome: string }> {
  const nome = `Paciente Substituicao ${rotulo} ${SUFIXO}`;
  await cadastrarPacienteDeTeste(cliente, nome);
  const resultado = await registrarEncaminhamentoNaTransacao(cliente, {
    pacienteNome: nome,
    dataEncaminhamento: DATA,
    numeroCarteirinha: carteirinhaDeTeste(),
    crmMedico: "123456",
  });

  if (!resultado.ok) {
    throw new Error(`preparo falhou: ${resultado.erro}`);
  }

  const paciente = await cliente.paciente.findFirstOrThrow({
    where: { nome },
    select: { id: true, nome: true },
  });

  return paciente;
}

async function criarTerapia(
  cliente: ClienteDaTransacao,
  rotulo: string,
): Promise<number> {
  const terapia = await cliente.terapia.create({
    data: {
      nome: `Terapia Substituicao ${rotulo} ${SUFIXO}`,
      codigoTiss: `SB${rotulo}`.slice(0, 10),
    },
    select: { id: true },
  });

  return terapia.id;
}

/** Envia uma requisição pelo domínio e falha o teste se não der certo. */
async function enviar(
  cliente: ClienteDaTransacao,
  pacienteNome: string,
  numeroRequisicao: string,
  terapias: { terapiaId: number; qtdAutorizada?: number }[],
  substituir = false,
): Promise<Extract<ResultadoCriacao, { ok: true }>> {
  const resultado = await criarRequisicaoNaTransacao(cliente, {
    pacienteNome,
    numeroRequisicao,
    linhas: terapias.map((terapia) => ({
      terapiaId: terapia.terapiaId,
      qtdAutorizada: terapia.qtdAutorizada ?? 10,
      validade: null,
    })),
    substituir,
  });

  if (!resultado.ok) {
    throw new Error(`envio falhou: ${resultado.erro}`);
  }

  return resultado;
}

async function guiaDe(
  cliente: ClienteDaTransacao,
  requisicaoId: number,
  terapiaId: number,
) {
  return cliente.requisicaoTerapia.findFirst({
    where: { requisicaoId, terapiaId },
    select: { id: true, qtdAutorizada: true },
  });
}

/** Lança `quantos` atendimentos direto na guia (o preparo não é o assunto). */
async function lancarAtendimentos(
  cliente: ClienteDaTransacao,
  guiaId: number,
  quantos: number,
): Promise<void> {
  for (let indice = 0; indice < quantos; indice += 1) {
    await cliente.atendimento.create({
      data: {
        requisicaoTerapiaId: guiaId,
        dataAtendimento: new Date(`${DATA}T00:00:00.000Z`),
        creditosConsumidos: 1,
      },
    });
  }
}

async function contarAtendimentos(
  cliente: ClienteDaTransacao,
  guiaId: number,
): Promise<number> {
  return cliente.atendimento.count({ where: { requisicaoTerapiaId: guiaId } });
}

/** Paciente com 333 (Fono + TO), com atendimentos nas duas guias. */
async function cenarioFonoETo(cliente: ClienteDaTransacao, rotulo: string) {
  const paciente = await pacienteComEncaminhamento(cliente, rotulo);
  const fono = await criarTerapia(cliente, `F${rotulo}`);
  const to = await criarTerapia(cliente, `T${rotulo}`);
  const antiga = await enviar(cliente, paciente.nome, "333", [
    { terapiaId: fono },
    { terapiaId: to },
  ]);
  const guiaFono = (await guiaDe(cliente, antiga.requisicaoId, fono))!;
  const guiaTo = (await guiaDe(cliente, antiga.requisicaoId, to))!;

  await lancarAtendimentos(cliente, guiaFono.id, 3);
  await lancarAtendimentos(cliente, guiaTo.id, 2);

  return { paciente, fono, to, antiga, guiaFono, guiaTo };
}

describe.skipIf(!temBanco)("substituição de guias da mesma terapia", () => {
  beforeAll(async () => {
    await getPrismaClient().$connect();
  });

  afterAll(async () => {
    await getPrismaClient().$disconnect();
  }, 60_000);

  it("marcada: a guia antiga da mesma terapia e os atendimentos dela somem; a outra terapia fica intacta", async () => {
    const r = await comRollback(async (tx) => {
      const c = await cenarioFonoETo(tx, "A");
      const nova = await enviar(
        tx,
        c.paciente.nome,
        "444",
        [{ terapiaId: c.fono }],
        true,
      );

      return {
        nova,
        c,
        guiaFonoAntiga: await tx.requisicaoTerapia.findUnique({
          where: { id: c.guiaFono.id },
        }),
        atendimentosFonoAntiga: await contarAtendimentos(tx, c.guiaFono.id),
        guiaToAntiga: await tx.requisicaoTerapia.findUnique({
          where: { id: c.guiaTo.id },
        }),
        atendimentosTo: await contarAtendimentos(tx, c.guiaTo.id),
        guiaNova: await guiaDe(tx, nova.requisicaoId, c.fono),
        requisicaoAntiga: await tx.requisicao.findUnique({
          where: { id: c.antiga.requisicaoId },
        }),
      };
    });

    expect(r.guiaFonoAntiga).toBeNull();
    expect(r.atendimentosFonoAntiga).toBe(0);
    expect(r.guiaToAntiga).not.toBeNull();
    expect(r.atendimentosTo).toBe(2);
    expect(r.guiaNova).not.toBeNull();
    expect(r.requisicaoAntiga).not.toBeNull();
    expect(r.nova.substituidas).toEqual([
      expect.objectContaining({
        guiaId: r.c.guiaFono.id,
        numeroRequisicao: "333",
        atendimentos: 3,
      }),
    ]);
    expect(r.nova.requisicoesApagadas).toEqual([]);
  });

  it("requisição antiga que fica vazia é apagada; a que ainda tem guia permanece", async () => {
    const r = await comRollback(async (tx) => {
      const paciente = await pacienteComEncaminhamento(tx, "B");
      const fono = await criarTerapia(tx, "FB");
      const to = await criarTerapia(tx, "TB");
      const so = await enviar(tx, paciente.nome, "111", [{ terapiaId: fono }]);
      const mista = await enviar(tx, paciente.nome, "222", [
        { terapiaId: fono },
        { terapiaId: to },
      ]);
      await lancarAtendimentos(
        tx,
        (await guiaDe(tx, so.requisicaoId, fono))!.id,
        1,
      );

      const nova = await enviar(
        tx,
        paciente.nome,
        "444",
        [{ terapiaId: fono }],
        true,
      );

      return {
        nova,
        so: await tx.requisicao.findUnique({ where: { id: so.requisicaoId } }),
        mista: await tx.requisicao.findUnique({
          where: { id: mista.requisicaoId },
        }),
        guiasDaMista: await tx.requisicaoTerapia.findMany({
          where: { requisicaoId: mista.requisicaoId },
          select: { terapiaId: true },
        }),
        to,
      };
    });

    expect(r.so).toBeNull();
    expect(r.mista).not.toBeNull();
    expect(r.guiasDaMista).toEqual([{ terapiaId: r.to }]);
    expect(r.nova.requisicoesApagadas).toEqual(["111"]);
    expect(r.nova.substituidas.map((guia) => guia.numeroRequisicao)).toEqual([
      "111",
      "222",
    ]);
  });

  it("marcada sem terapia em comum: nada é apagado", async () => {
    const r = await comRollback(async (tx) => {
      const c = await cenarioFonoETo(tx, "C");
      const outra = await criarTerapia(tx, "OC");
      const nova = await enviar(
        tx,
        c.paciente.nome,
        "444",
        [{ terapiaId: outra }],
        true,
      );

      return {
        nova,
        guias: await tx.requisicaoTerapia.count({
          where: { id: { in: [c.guiaFono.id, c.guiaTo.id] } },
        }),
        atendimentos:
          (await contarAtendimentos(tx, c.guiaFono.id)) +
          (await contarAtendimentos(tx, c.guiaTo.id)),
      };
    });

    expect(r.nova.substituidas).toEqual([]);
    expect(r.nova.requisicoesApagadas).toEqual([]);
    expect(r.guias).toBe(2);
    expect(r.atendimentos).toBe(5);
  });

  it("desmarcada: nada é apagado, as guias da mesma terapia coexistem", async () => {
    const r = await comRollback(async (tx) => {
      const c = await cenarioFonoETo(tx, "D");
      const nova = await enviar(
        tx,
        c.paciente.nome,
        "444",
        [{ terapiaId: c.fono }],
        false,
      );

      return {
        nova,
        antiga: await tx.requisicaoTerapia.findUnique({
          where: { id: c.guiaFono.id },
        }),
        atendimentos: await contarAtendimentos(tx, c.guiaFono.id),
        guiaNova: await guiaDe(tx, nova.requisicaoId, c.fono),
      };
    });

    expect(r.antiga).not.toBeNull();
    expect(r.atendimentos).toBe(3);
    expect(r.guiaNova).not.toBeNull();
    expect(r.nova.substituidas).toEqual([]);
  });

  it("outro paciente com a mesma terapia não é afetado", async () => {
    const r = await comRollback(async (tx) => {
      const c = await cenarioFonoETo(tx, "E");
      const vizinho = await pacienteComEncaminhamento(tx, "E-vizinho");
      const doVizinho = await enviar(tx, vizinho.nome, "333", [
        { terapiaId: c.fono },
      ]);
      const guiaDoVizinho = (await guiaDe(tx, doVizinho.requisicaoId, c.fono))!;
      await lancarAtendimentos(tx, guiaDoVizinho.id, 4);

      const nova = await enviar(
        tx,
        c.paciente.nome,
        "444",
        [{ terapiaId: c.fono }],
        true,
      );

      return {
        nova,
        guiaDoVizinho: await tx.requisicaoTerapia.findUnique({
          where: { id: guiaDoVizinho.id },
        }),
        atendimentosDoVizinho: await contarAtendimentos(tx, guiaDoVizinho.id),
        guiaFonoAntiga: await tx.requisicaoTerapia.findUnique({
          where: { id: c.guiaFono.id },
        }),
      };
    });

    expect(r.guiaDoVizinho).not.toBeNull();
    expect(r.atendimentosDoVizinho).toBe(4);
    // E a do próprio paciente saiu, para o teste não passar por não fazer nada.
    expect(r.guiaFonoAntiga).toBeNull();
    expect(r.nova.substituidas).toHaveLength(1);
  });

  it("guia da mesma requisição (mesmo número) segue o caminho de atualização, sem apagar", async () => {
    const r = await comRollback(async (tx) => {
      const c = await cenarioFonoETo(tx, "F");
      const outra = await enviar(tx, c.paciente.nome, "222", [
        { terapiaId: c.fono },
      ]);
      const guiaDa222 = (await guiaDe(tx, outra.requisicaoId, c.fono))!;

      const reenvio = await enviar(
        tx,
        c.paciente.nome,
        "333",
        [{ terapiaId: c.fono, qtdAutorizada: 20 }],
        true,
      );

      return {
        reenvio,
        guiaFono: await tx.requisicaoTerapia.findUnique({
          where: { id: c.guiaFono.id },
        }),
        atendimentosFono: await contarAtendimentos(tx, c.guiaFono.id),
        guiaDa222: await tx.requisicaoTerapia.findUnique({
          where: { id: guiaDa222.id },
        }),
      };
    });

    // A guia da 333 é a mesma linha, atualizada, com os atendimentos.
    expect(r.guiaFono?.qtdAutorizada).toBe(20);
    expect(r.atendimentosFono).toBe(3);
    expect(r.reenvio).toMatchObject({
      requisicaoCriada: false,
      terapiasAtualizadas: 1,
      terapiasAdicionadas: 0,
    });
    // A de outro número, essa sim, foi substituída — e só ela.
    expect(r.guiaDa222).toBeNull();
    expect(r.reenvio.substituidas.map((guia) => guia.numeroRequisicao)).toEqual(
      ["222"],
    );
  });

  it("a prévia devolve exatamente o que a transação apaga, e nada escreve", async () => {
    const r = await comRollback(async (tx) => {
      const c = await cenarioFonoETo(tx, "G");
      await enviar(tx, c.paciente.nome, "222", [{ terapiaId: c.to }]);
      const terapias = [c.fono, c.to];

      const antes = await tx.requisicaoTerapia.count({
        where: { requisicao: { pacienteId: c.paciente.id } },
      });
      // Caixa e espaços diferentes: a prévia acha o paciente como a criação acha.
      const previa = await previsaoDeSubstituicaoComCliente(
        tx,
        `  ${c.paciente.nome.toUpperCase()} `,
        terapias,
        " 444 ",
      );
      const depoisDaPrevia = await tx.requisicaoTerapia.count({
        where: { requisicao: { pacienteId: c.paciente.id } },
      });

      const nova = await enviar(
        tx,
        c.paciente.nome,
        "444",
        terapias.map((terapiaId) => ({ terapiaId })),
        true,
      );

      return { previa, nova, antes, depoisDaPrevia };
    });

    expect(r.depoisDaPrevia).toBe(r.antes);
    expect(r.previa).toHaveLength(3);
    expect(r.nova.substituidas).toEqual(r.previa);
  });

  it("a prévia de um nome que não é de ninguém volta vazia", async () => {
    const previa = await comRollback((tx) =>
      previsaoDeSubstituicaoComCliente(tx, `Ninguem ${SUFIXO}`, [1], "444"),
    );

    expect(previa).toEqual([]);
  });

  it("o saldo da guia nova começa limpo na view", async () => {
    const saldo = await comRollback(async (tx) => {
      const c = await cenarioFonoETo(tx, "H");
      const nova = await enviar(
        tx,
        c.paciente.nome,
        "444",
        [{ terapiaId: c.fono, qtdAutorizada: 8 }],
        true,
      );
      const guia = (await guiaDe(tx, nova.requisicaoId, c.fono))!;

      const [linha] = await tx.$queryRaw<
        { qtdUtilizada: number; saldoRestante: number }[]
      >`
        SELECT "qtd_utilizada"::int AS "qtdUtilizada",
               "saldo_restante"::int AS "saldoRestante"
        FROM "requisicao_terapia_saldo" WHERE "id" = ${guia.id}
      `;

      return linha;
    });

    expect(saldo).toEqual({ qtdUtilizada: 0, saldoRestante: 8 });
  });
});

// ---------------------------------------------------------------------------
// Atomicidade e corrida: precisam de commit de verdade
// ---------------------------------------------------------------------------

type CenarioCommitado = Awaited<ReturnType<typeof cenarioFonoETo>>;

async function criarCenarioCommitado(
  rotulo: string,
): Promise<CenarioCommitado> {
  const prisma = getPrismaClient();
  const cenario = await prisma.$transaction(
    (tx) => cenarioFonoETo(tx, rotulo),
    {
      maxWait: 30_000,
      timeout: 30_000,
    },
  );

  // Lançamento só entra em requisição aprovada (regra 19).
  await prisma.requisicao.update({
    where: { id: cenario.antiga.requisicaoId },
    data: { situacao: "aprovada" },
  });

  return cenario;
}

/**
 * Apaga paciente (com encaminhamento, requisições, guias e atendimentos) e as
 * terapias do cenário. Cada passo no seu `try`: o que não sair fica no log.
 */
async function apagarCenario(cenario: CenarioCommitado): Promise<void> {
  try {
    const resultado = await excluirPacientePeloId(cenario.paciente.id);

    if (!resultado.ok) {
      console.error(
        `[requisicoes-substituicao.integration] paciente ${cenario.paciente.id} não apagado: ${resultado.erro}`,
      );
    }
  } catch (erro) {
    console.error(
      `[requisicoes-substituicao.integration] limpeza NAO apagou paciente ${cenario.paciente.id}.`,
      erro,
    );
  }

  try {
    await getPrismaClient().terapia.deleteMany({
      where: { id: { in: [cenario.fono, cenario.to] } },
    });
  } catch (erro) {
    console.error(
      `[requisicoes-substituicao.integration] limpeza NAO apagou terapias ${cenario.fono}, ${cenario.to}.`,
      erro,
    );
  }
}

function entradaSubstituindoFono(
  cenario: CenarioCommitado,
): EntradaNovaRequisicao {
  return {
    pacienteNome: cenario.paciente.nome,
    numeroRequisicao: "444",
    linhas: [{ terapiaId: cenario.fono, qtdAutorizada: 10, validade: null }],
    substituir: true,
  };
}

describe.skipIf(!temBanco)("substituição: atomicidade", () => {
  it("se a criação da guia nova falhar depois da exclusão, as guias antigas e os atendimentos continuam lá", async () => {
    const cenario = await criarCenarioCommitado("ATOM");
    let excluiuAntes = false;

    try {
      // A transação é a mesma de `criarRequisicao` (`$transaction` em volta
      // de `criarNaTransacao`); o dublê só faz a criação da requisição nova
      // estourar, **depois** de a substituição ter apagado a guia antiga.
      await expect(
        getPrismaClient().$transaction(
          (tx) => {
            const sabotado = new Proxy(tx, {
              get(alvo, chave, receptor) {
                if (chave === "requisicao") {
                  const original = Reflect.get(alvo, chave, receptor);

                  return new Proxy(original, {
                    get(modelo, metodo, rec) {
                      if (metodo === "create") {
                        return async () => {
                          throw new Error(
                            "falha simulada na criação da guia nova",
                          );
                        };
                      }

                      return Reflect.get(modelo, metodo, rec);
                    },
                  });
                }

                if (chave === "requisicaoTerapia") {
                  const original = Reflect.get(alvo, chave, receptor);

                  return new Proxy(original, {
                    get(modelo, metodo, rec) {
                      const valor = Reflect.get(modelo, metodo, rec);

                      if (metodo === "delete") {
                        return async (...args: unknown[]) => {
                          const saida = await valor.apply(modelo, args);
                          excluiuAntes = true;
                          return saida;
                        };
                      }

                      return valor;
                    },
                  });
                }

                return Reflect.get(alvo, chave, receptor);
              },
            });

            return criarRequisicaoNaTransacao(
              sabotado,
              entradaSubstituindoFono(cenario),
            );
          },
          { maxWait: 30_000, timeout: 30_000 },
        ),
      ).rejects.toThrow("falha simulada");

      // A exclusão aconteceu dentro da transação — e foi desfeita com ela.
      expect(excluiuAntes).toBe(true);

      const prisma = getPrismaClient();
      expect(
        await prisma.requisicaoTerapia.count({
          where: { id: { in: [cenario.guiaFono.id, cenario.guiaTo.id] } },
        }),
      ).toBe(2);
      expect(await contarAtendimentos(prisma, cenario.guiaFono.id)).toBe(3);
      expect(await contarAtendimentos(prisma, cenario.guiaTo.id)).toBe(2);
      expect(
        await prisma.requisicao.count({
          where: { pacienteId: cenario.paciente.id, numeroRequisicao: "444" },
        }),
      ).toBe(0);
    } finally {
      await apagarCenario(cenario);
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Corrida entre lançamento de atendimento e substituição
// ---------------------------------------------------------------------------

function criarPortao() {
  let abrir!: () => void;
  const promessa = new Promise<void>((resolve) => {
    abrir = resolve;
  });

  return { promessa, abrir };
}

function aguardar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function esperarAte(
  condicao: () => boolean | Promise<boolean>,
  limiteMs: number,
): Promise<boolean> {
  const fim = Date.now() + limiteMs;

  while (Date.now() < fim) {
    if (await condicao()) {
      return true;
    }

    await aguardar(25);
  }

  return false;
}

/** `true` quando outra conexão está parada esperando lock num `FOR UPDATE`. */
async function existeConexaoBloqueadaEmForUpdate(): Promise<boolean> {
  const [linha] = await getPrismaClient().$queryRaw<{ total: bigint }[]>`
    SELECT count(*) AS "total"
    FROM pg_stat_activity a
    WHERE a."datname" = current_database()
      AND a."pid" <> pg_backend_pid()
      AND a."wait_event_type" = 'Lock'
      AND a."query" ILIKE '%FOR UPDATE%'
  `;

  return Number(linha.total) > 0;
}

/** Mesmo motivo de `aquecerPool` em `atendimentos.integration.test.ts`. */
async function aquecerPool(conexoes = 4): Promise<void> {
  await Promise.all(
    Array.from(
      { length: conexoes },
      () => getPrismaClient().$queryRaw`SELECT pg_sleep(0.2)::text AS "ok"`,
    ),
  );
}

describe.skipIf(!temBanco)(
  "substituição: corrida com lançamento de atendimento",
  () => {
    const criados: CenarioCommitado[] = [];

    afterAll(async () => {
      for (const cenario of criados) {
        await apagarCenario(cenario);
      }
    }, 60_000);

    it("lançamento segurando a guia: a substituição espera, e o atendimento novo é apagado junto", async () => {
      const cenario = await criarCenarioCommitado("CORRIDA1");
      criados.push(cenario);

      await aquecerPool();

      const portao = criarPortao();
      let resultadoA: ResultadoDoLote | null = null;

      // A: lança na guia antiga de Fono e para no portão, com o lock de pé.
      const transacaoA = getPrismaClient().$transaction(
        async (tx) => {
          resultadoA = await lancarLoteNaTransacao(tx, {
            pacienteId: cenario.paciente.id,
            dataAtendimento: DATA,
            observacao: null,
            itens: [
              {
                requisicaoTerapiaId: cenario.guiaFono.id,
                creditosConsumidos: 1,
              },
            ],
          });
          await portao.promessa;

          return resultadoA;
        },
        { maxWait: 30_000, timeout: 30_000 },
      );

      const pendentes: Promise<unknown>[] = [transacaoA];

      try {
        expect(await esperarAte(() => resultadoA !== null, 10_000)).toBe(true);
        expect(resultadoA).toMatchObject({ ok: true });

        // B: a função de produção, com A aberta. O FOR UPDATE das guias espera A.
        let bTerminou = false;
        const transacaoB = criarRequisicao(
          entradaSubstituindoFono(cenario),
        ).finally(() => {
          bTerminou = true;
        });
        pendentes.push(transacaoB);

        expect(await esperarAte(existeConexaoBloqueadaEmForUpdate, 3_000)).toBe(
          true,
        );
        expect(bTerminou).toBe(false);

        portao.abrir();

        const [a, b] = await Promise.all([transacaoA, transacaoB]);

        expect(a).toMatchObject({ ok: true, totalDeAtendimentos: 1 });
        // B enxergou o atendimento que A commitou (3 + 1) e o apagou junto.
        expect(b).toMatchObject({ ok: true });
        expect(b.ok && b.substituidas).toEqual([
          expect.objectContaining({
            guiaId: cenario.guiaFono.id,
            atendimentos: 4,
          }),
        ]);

        const prisma = getPrismaClient();
        expect(
          await prisma.requisicaoTerapia.findUnique({
            where: { id: cenario.guiaFono.id },
          }),
        ).toBeNull();
        expect(await contarAtendimentos(prisma, cenario.guiaFono.id)).toBe(0);
        expect(await contarAtendimentos(prisma, cenario.guiaTo.id)).toBe(2);
      } finally {
        portao.abrir();
        await Promise.allSettled(pendentes);
      }
    }, 60_000);

    it("substituição segurando a guia: o lançamento espera e é recusado, sem atendimento órfão", async () => {
      const cenario = await criarCenarioCommitado("CORRIDA2");
      criados.push(cenario);

      await aquecerPool();

      const portao = criarPortao();
      let resultadoA: ResultadoCriacao | null = null;

      // A: a substituição, parada no portão depois de apagar, sem commitar.
      const transacaoA = getPrismaClient().$transaction(
        async (tx) => {
          resultadoA = await criarRequisicaoNaTransacao(
            tx,
            entradaSubstituindoFono(cenario),
          );
          await portao.promessa;

          return resultadoA;
        },
        { maxWait: 30_000, timeout: 30_000 },
      );

      const pendentes: Promise<unknown>[] = [transacaoA];

      try {
        expect(await esperarAte(() => resultadoA !== null, 10_000)).toBe(true);
        expect(resultadoA).toMatchObject({ ok: true });

        // B: lançamento de produção na guia que A apagou e ainda trava.
        const transacaoB = lancarLote({
          pacienteId: cenario.paciente.id,
          dataAtendimento: DATA,
          observacao: null,
          itens: [
            { requisicaoTerapiaId: cenario.guiaFono.id, creditosConsumidos: 1 },
          ],
        });
        pendentes.push(transacaoB);

        expect(await esperarAte(existeConexaoBloqueadaEmForUpdate, 3_000)).toBe(
          true,
        );

        portao.abrir();
        await transacaoA;
        const b = await transacaoB;

        // Recusa de negócio, não erro de FK.
        expect(b).toMatchObject({ ok: false, erro: ERRO_GUIA_INEXISTENTE });
        expect(
          await contarAtendimentos(getPrismaClient(), cenario.guiaFono.id),
        ).toBe(0);
        expect(
          await getPrismaClient().atendimento.count({
            where: {
              requisicaoTerapia: {
                requisicao: { pacienteId: cenario.paciente.id },
              },
            },
          }),
        ).toBe(2);
      } finally {
        portao.abrir();
        await Promise.allSettled(pendentes);
      }
    }, 60_000);
  },
);

/**
 * A exclusão permanente de paciente contra o Postgres real.
 *
 * Este arquivo é o único do projeto cujo objeto de teste **apaga prontuário**.
 * Três coisas precisam ser verdade, e nenhuma delas dá para provar sem banco:
 *
 *   1. A exclusão leva mesmo **tudo** — paciente, encaminhamento, requisições,
 *      guias e os atendimentos que pendem delas por `ON DELETE CASCADE`. Fica
 *      zero linha com aquele `paciente_id` nas quatro tabelas.
 *   2. **Ou vai tudo, ou não vai nada.** Um erro no meio da sequência tem de
 *      devolver o banco ao estado anterior, e não deixar o paciente sem
 *      atendimentos (que é o pior desfecho possível: um prontuário mutilado é
 *      mais perigoso que um prontuário apagado, porque parece íntegro).
 *   3. Paciente sem requisição nenhuma — só encaminhamento — é apagado do mesmo
 *      jeito, sem erro por tabela vazia.
 *
 * Como roda (mesmo contrato de `requisicoes.integration.test.ts`):
 *   - precisa de DATABASE_URL com as migrations aplicadas; sem ela o bloco é
 *     pulado em vez de falhar;
 *   - os dois primeiros cenários rodam dentro de uma transação que sempre sofre
 *     rollback. **O do rollback não pode**: para provar que uma transação
 *     desfez o que escreveu, o cenário precisa existir commitado antes dela. Só
 *     esse caso escreve no banco para valer, e ele limpa o que criou num
 *     `finally`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getPrismaClient } from "@/lib/db";

import { registrarEncaminhamentoNaTransacao } from "./encaminhamentos";
import {
  contarParaExclusao,
  excluirPacienteNaTransacao,
  excluirPacientePeloId,
  ERRO_ID_INVALIDO,
  ERRO_PACIENTE_INEXISTENTE,
} from "./pacientes";

const temBanco = Boolean(process.env.DATABASE_URL);

/** Sufixo único para não colidir com paciente/terapia já existentes. */
const SUFIXO = Math.random().toString(36).slice(2, 10);

/** Erro sentinela: rola a transação de volta depois de coletar o resultado. */
class Rollback<T> extends Error {
  constructor(readonly dados: T) {
    super("rollback proposital do teste de integracao");
  }
}

/** Erro injetado no meio da exclusão, para forçar o rollback. */
class ErroInjetado extends Error {
  constructor() {
    super("falha injetada entre dois DELETE");
    this.name = "ErroInjetado";
  }
}

type ClienteDaTransacao = Parameters<
  Parameters<ReturnType<typeof getPrismaClient>["$transaction"]>[0]
>[0];

/** Roda `executar` numa transação e desfaz tudo, devolvendo o que ela produziu. */
async function comRollback<T>(
  executar: (tx: ClienteDaTransacao) => Promise<T>,
): Promise<T> {
  try {
    await getPrismaClient().$transaction(
      async (tx) => {
        throw new Rollback(await executar(tx));
      },
      // `maxWait` é o tempo para *conseguir* a transação, e o padrão (2s) não
      // cobre a primeira, que ainda paga o custo de abrir a conexão.
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

/** O que existe no banco para um `paciente_id`, tabela por tabela. */
type Contagens = {
  paciente: number;
  encaminhamento: number;
  requisicoes: number;
  guias: number;
  atendimentos: number;
};

/**
 * Conta as cinco tabelas de uma vez, pelo `paciente_id`.
 *
 * Deliberadamente **não** reaproveita `contarParaExclusao`: aquela é a função
 * sob teste, e uma asserção que usa o código que ela deveria estar verificando
 * concorda consigo mesma. Esta é SQL escrita à mão, e conta também o paciente e
 * o encaminhamento, que a outra não conta.
 */
async function contarLinhas(
  cliente: Pick<ClienteDaTransacao, "$queryRaw">,
  pacienteId: number,
): Promise<Contagens> {
  const [linha] = await cliente.$queryRaw<Contagens[]>`
    SELECT
      (
        SELECT count(*)::int FROM "paciente" p WHERE p."id" = ${pacienteId}
      ) AS "paciente",
      (
        SELECT count(*)::int FROM "encaminhamento" e
        WHERE e."paciente_id" = ${pacienteId}
      ) AS "encaminhamento",
      (
        SELECT count(*)::int FROM "requisicao" r
        WHERE r."paciente_id" = ${pacienteId}
      ) AS "requisicoes",
      (
        SELECT count(*)::int
        FROM "requisicao_terapia" rt
        JOIN "requisicao" r ON r."id" = rt."requisicao_id"
        WHERE r."paciente_id" = ${pacienteId}
      ) AS "guias",
      (
        SELECT count(*)::int
        FROM "atendimento" a
        JOIN "requisicao_terapia" rt ON rt."id" = a."requisicao_terapia_id"
        JOIN "requisicao" r ON r."id" = rt."requisicao_id"
        WHERE r."paciente_id" = ${pacienteId}
      ) AS "atendimentos"
    FROM (SELECT 1) AS "uma_linha"
  `;

  return linha;
}

/** O cenário completo do enunciado, montado com o cliente que for entregue. */
type Cenario = { pacienteId: number; terapiaId: number };

/**
 * Um paciente com 1 encaminhamento, 1 requisição, 2 guias e 3 atendimentos.
 *
 * Os 3 atendimentos ficam distribuídos 2 + 1 entre as duas guias de propósito:
 * uma guia vazia junto de uma guia cheia é o arranjo que pega um `DELETE` que
 * só alcance a primeira linha de cada tabela.
 */
async function montarCenario(
  tx: ClienteDaTransacao,
  nome: string,
  rotulo: string,
): Promise<Cenario> {
  const encaminhamento = await registrarEncaminhamentoNaTransacao(tx, {
    pacienteNome: nome,
    dataEncaminhamento: "2026-03-10",
  });

  if (!encaminhamento.ok) {
    throw new Error(`preparo falhou: ${encaminhamento.erro}`);
  }

  const [paciente] = await tx.$queryRaw<{ id: number }[]>`
    SELECT "id" FROM "paciente" WHERE lower("nome") = lower(${nome})
  `;

  const terapia = await tx.terapia.create({
    data: {
      nome: `Terapia Exclusao ${rotulo} ${SUFIXO}`,
      codigoTiss: `X${rotulo}`.slice(0, 10),
    },
    select: { id: true },
  });

  const requisicao = await tx.requisicao.create({
    data: {
      numeroRequisicao: `REQ-EXC-${rotulo}-${SUFIXO}`,
      pacienteId: paciente.id,
      guias: {
        create: [
          { terapiaId: terapia.id, qtdAutorizada: 10, validade: null },
          { terapiaId: terapia.id, qtdAutorizada: 20, validade: null },
        ],
      },
    },
    select: { id: true, guias: { select: { id: true }, orderBy: { id: "asc" } } },
  });

  await tx.atendimento.createMany({
    data: [
      {
        dataAtendimento: new Date("2026-03-11T00:00:00.000Z"),
        creditosConsumidos: 1,
        requisicaoTerapiaId: requisicao.guias[0].id,
      },
      {
        dataAtendimento: new Date("2026-03-12T00:00:00.000Z"),
        creditosConsumidos: 2,
        requisicaoTerapiaId: requisicao.guias[0].id,
      },
      {
        dataAtendimento: new Date("2026-03-13T00:00:00.000Z"),
        creditosConsumidos: 1,
        requisicaoTerapiaId: requisicao.guias[1].id,
      },
    ],
  });

  return { pacienteId: paciente.id, terapiaId: terapia.id };
}

/**
 * Um cliente de transação que estoura no N-ésimo `$executeRaw`.
 *
 * É o `tx` que já é parâmetro de `excluirPacienteNaTransacao` servindo de
 * costura para a injeção — nenhum gancho de teste precisou entrar no código de
 * produção. Com `qual = 2`, o primeiro `DELETE` (guias, e os atendimentos por
 * cascade) executa de verdade e o segundo (requisições) nunca chega ao banco:
 * a exclusão para exatamente no meio, que é o estado que o rollback tem de
 * desfazer.
 *
 * As funções são amarradas ao alvo (`bind`) em vez de devolvidas cruas: o
 * cliente do Prisma guarda estado interno e um método arrancado do objeto
 * perderia o `this`.
 */
function txQueFalhaNoDelete(
  tx: ClienteDaTransacao,
  qual: number,
): ClienteDaTransacao {
  let executados = 0;

  return new Proxy(tx, {
    get(alvo, propriedade) {
      const valor = Reflect.get(alvo, propriedade) as unknown;

      if (propriedade !== "$executeRaw") {
        return typeof valor === "function" ? valor.bind(alvo) : valor;
      }

      return (...argumentos: unknown[]) => {
        executados += 1;

        if (executados === qual) {
          throw new ErroInjetado();
        }

        return (valor as (...a: unknown[]) => unknown).apply(alvo, argumentos);
      };
    },
  }) as ClienteDaTransacao;
}

describe.skipIf(!temBanco)("exclusao permanente de paciente", () => {
  beforeAll(async () => {
    // Abre a conexão fora do relógio da primeira transação.
    await getPrismaClient().$connect();
  });

  afterAll(async () => {
    await getPrismaClient().$disconnect();
  });

  it("apaga paciente, encaminhamento, requisição, guias e atendimentos", async () => {
    const nome = `Exclusao Completa ${SUFIXO}`;

    const resultado = await comRollback(async (tx) => {
      const cenario = await montarCenario(tx, nome, "completa");

      const antes = await contarLinhas(tx, cenario.pacienteId);

      const exclusao = await excluirPacienteNaTransacao(tx, cenario.pacienteId);

      const depois = await contarLinhas(tx, cenario.pacienteId);

      return { antes, exclusao, depois };
    });

    // O cenário do enunciado, conferido antes de apagar: sem isto um DELETE que
    // não apaga nada passaria no teste por vacuidade.
    expect(resultado.antes).toEqual({
      paciente: 1,
      encaminhamento: 1,
      requisicoes: 1,
      guias: 2,
      atendimentos: 3,
    });

    expect(resultado.exclusao).toEqual({
      ok: true,
      pacienteNome: nome,
      requisicoes: 1,
      guias: 2,
      atendimentos: 3,
    });

    // O ponto do teste: zero linha daquele `paciente_id` em qualquer tabela. Os
    // 3 atendimentos foram embora sem um `DELETE FROM atendimento` — é o
    // `ON DELETE CASCADE` de `atendimento -> requisicao_terapia` trabalhando.
    expect(resultado.depois).toEqual({
      paciente: 0,
      encaminhamento: 0,
      requisicoes: 0,
      guias: 0,
      atendimentos: 0,
    });
  });

  it("apaga o paciente que só tem encaminhamento, sem erro por tabela vazia", async () => {
    const nome = `Exclusao So Encaminhamento ${SUFIXO}`;

    const resultado = await comRollback(async (tx) => {
      const encaminhamento = await registrarEncaminhamentoNaTransacao(tx, {
        pacienteNome: nome,
        dataEncaminhamento: "2026-04-01",
      });

      if (!encaminhamento.ok) {
        throw new Error(`preparo falhou: ${encaminhamento.erro}`);
      }

      const [paciente] = await tx.$queryRaw<{ id: number }[]>`
        SELECT "id" FROM "paciente" WHERE lower("nome") = lower(${nome})
      `;

      const antes = await contarLinhas(tx, paciente.id);
      const exclusao = await excluirPacienteNaTransacao(tx, paciente.id);
      const depois = await contarLinhas(tx, paciente.id);

      return { antes, exclusao, depois };
    });

    expect(resultado.antes).toEqual({
      paciente: 1,
      encaminhamento: 1,
      requisicoes: 0,
      guias: 0,
      atendimentos: 0,
    });

    // Os três `DELETE` que não têm o que apagar rodam e afetam zero linha — é
    // um não-evento no Postgres, não um erro.
    expect(resultado.exclusao).toEqual({
      ok: true,
      pacienteNome: nome,
      requisicoes: 0,
      guias: 0,
      atendimentos: 0,
    });

    expect(resultado.depois).toEqual({
      paciente: 0,
      encaminhamento: 0,
      requisicoes: 0,
      guias: 0,
      atendimentos: 0,
    });
  });

  it("desfaz tudo quando um erro acontece entre dois DELETE", async () => {
    const nome = `Exclusao Rollback ${SUFIXO}`;

    // Commitado de propósito: uma transação só pode ser provada desfeita se o
    // que ela apagou existia **fora** dela. É o único cenário deste arquivo que
    // deixa linha no banco — o `finally` a recolhe.
    const cenario = await getPrismaClient().$transaction(
      (tx) => montarCenario(tx, nome, "rollback"),
      { maxWait: 30_000, timeout: 30_000 },
    );

    try {
      const antes = await contarLinhas(getPrismaClient(), cenario.pacienteId);

      expect(antes).toEqual({
        paciente: 1,
        encaminhamento: 1,
        requisicoes: 1,
        guias: 2,
        atendimentos: 3,
      });

      await expect(
        getPrismaClient().$transaction(
          (tx) =>
            excluirPacienteNaTransacao(
              // Falha no segundo `$executeRaw`: as guias (e, por cascade, os
              // atendimentos) já foram apagadas dentro da transação quando o
              // erro estoura.
              txQueFalhaNoDelete(tx, 2),
              cenario.pacienteId,
            ),
          { maxWait: 30_000, timeout: 30_000 },
        ),
      ).rejects.toThrow(ErroInjetado);

      // O ponto do teste: **nada** foi apagado. Sem a transação, este cenário
      // teria perdido as 2 guias e os 3 atendimentos e mantido a requisição, o
      // encaminhamento e o paciente — um prontuário mutilado que ainda parece
      // íntegro na tela.
      expect(await contarLinhas(getPrismaClient(), cenario.pacienteId)).toEqual(
        antes,
      );
    } finally {
      // Limpeza em SQL cru, e não pela função sob teste: se ela estiver
      // quebrada, é justamente quando a limpeza precisa funcionar.
      await getPrismaClient().$executeRaw`
        DELETE FROM "requisicao_terapia"
        WHERE "requisicao_id" IN (
          SELECT "id" FROM "requisicao" WHERE "paciente_id" = ${cenario.pacienteId}
        )
      `;
      await getPrismaClient().$executeRaw`
        DELETE FROM "requisicao" WHERE "paciente_id" = ${cenario.pacienteId}
      `;
      await getPrismaClient().$executeRaw`
        DELETE FROM "encaminhamento" WHERE "paciente_id" = ${cenario.pacienteId}
      `;
      await getPrismaClient().$executeRaw`
        DELETE FROM "paciente" WHERE "id" = ${cenario.pacienteId}
      `;
      await getPrismaClient().$executeRaw`
        DELETE FROM "terapia" WHERE "id" = ${cenario.terapiaId}
      `;
    }
  });

  it("conta o que será apagado antes de qualquer confirmação", async () => {
    const nome = `Exclusao Contagem ${SUFIXO}`;

    const resultado = await comRollback(async (tx) => {
      const cenario = await montarCenario(tx, nome, "contagem");

      // Lida com o cliente da transação de propósito: `contarParaExclusao` usa
      // o cliente global e não enxergaria um cenário que ainda não commitou.
      // O que interessa aqui é o SQL da contagem, e ele é o mesmo dos dois.
      const contagem = await contarLinhas(tx, cenario.pacienteId);

      return { contagem };
    });

    // São estes dois números que a frase do diálogo cita — "N requisição(ões) e
    // N atendimento(s)" —, e é por serem lidos que a frase pode ser específica.
    expect(resultado.contagem.requisicoes).toBe(1);
    expect(resultado.contagem.atendimentos).toBe(3);
  });

  it("recusa id inválido sem tocar no banco", async () => {
    expect(await contarParaExclusao(0)).toEqual({
      ok: false,
      erro: ERRO_ID_INVALIDO,
    });
    expect(await excluirPacientePeloId(-1)).toEqual({
      ok: false,
      erro: ERRO_ID_INVALIDO,
    });
  });

  it("recusa paciente inexistente", async () => {
    // O `serial` está muito longe daqui.
    const inexistente = 2_000_000_000;

    expect(await contarParaExclusao(inexistente)).toEqual({
      ok: false,
      erro: ERRO_PACIENTE_INEXISTENTE,
    });
    expect(await excluirPacientePeloId(inexistente)).toEqual({
      ok: false,
      erro: ERRO_PACIENTE_INEXISTENTE,
    });
  });
});

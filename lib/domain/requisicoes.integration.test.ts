/**
 * Contraparte de `requisicoes.test.ts` contra o Postgres real.
 *
 * O teste unitário prova que o nosso código decide certo; este prova que o
 * banco concorda — que o `ON CONFLICT (lower("nome"))` reaproveita mesmo o
 * paciente escrito com outra caixa, que a unique
 * `(paciente_id, numero_requisicao)` é por paciente e não global, que repetir
 * o número de um paciente acrescenta terapias à requisição que já existe (em
 * vez de esbarrar na unique), e que uma linha de terapia ruim leva a transação
 * inteira embora.
 *
 * Como roda (mesmo contrato de `guias.integration.test.ts`):
 *   - precisa de DATABASE_URL com as migrations aplicadas; sem ela o bloco é
 *     pulado em vez de falhar;
 *   - o que grava com sucesso roda dentro de uma transação que sempre sofre
 *     rollback, então o banco de desenvolvimento não fica com lixo.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getPrismaClient } from "@/lib/db";

import { registrarEncaminhamentoNaTransacao } from "./encaminhamentos";
import { obterOuCriarPaciente } from "./pacientes";
import {
  criarRequisicao,
  criarRequisicaoNaTransacao,
  ERRO_QTD_INVALIDA,
  ERRO_SEM_ENCAMINHAMENTO,
  ERRO_TERAPIA_INEXISTENTE,
} from "./requisicoes";

const temBanco = Boolean(process.env.DATABASE_URL);

/** Sufixo único para não colidir com paciente/terapia já existentes. */
const SUFIXO = Math.random().toString(36).slice(2, 10);

/** Id de terapia que seguramente não existe (o `serial` está longe daqui). */
const TERAPIA_INEXISTENTE = 2_000_000_000;

/** Erro sentinela: rola a transação de volta depois de coletar o resultado. */
class Rollback<T> extends Error {
  constructor(readonly dados: T) {
    super("rollback proposital do teste de integracao");
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

/** Cria uma terapia descartável dentro da transação do teste. */
async function criarTerapia(
  tx: ClienteDaTransacao,
  rotulo: string,
): Promise<number> {
  const terapia = await tx.terapia.create({
    data: {
      nome: `Terapia Requisicao ${rotulo} ${SUFIXO}`,
      codigoTiss: `R${rotulo}`.slice(0, 10),
    },
    select: { id: true },
  });

  return terapia.id;
}

/**
 * Data de encaminhamento que **não** está vencida hoje nem daqui a meses.
 *
 * Relativa ao `CURRENT_DATE` do banco, e não um literal: os 180 dias correm a
 * partir dela, então uma data fixa faria estes testes começarem a exercitar o
 * caso "vencido" sem ninguém notar — e o caso vencido tem teste próprio, que
 * pede o contrário.
 */
async function dataDeEncaminhamentoEmDia(
  tx: ClienteDaTransacao,
): Promise<string> {
  const [linha] = await tx.$queryRaw<{ data: string }[]>`
    SELECT CURRENT_DATE::text AS "data"
  `;

  return linha.data;
}

/**
 * "AAAA-MM-DD" a `dias` dias do `CURRENT_DATE` **do banco**.
 *
 * Mesmo motivo de {@link dataDeEncaminhamentoEmDia}: o alerta de validade da
 * guia conta dias contra o `CURRENT_DATE`, e uma data literal faria o status
 * esperado mudar sozinho com a passagem do tempo. `date + int` devolve `date`,
 * então não há interval nem fuso no caminho.
 */
async function dataEmDias(
  tx: ClienteDaTransacao,
  dias: number,
): Promise<string> {
  const [linha] = await tx.$queryRaw<{ data: string }[]>`
    SELECT (CURRENT_DATE + ${dias}::int)::text AS "data"
  `;

  return linha.data;
}

/**
 * Dá ao paciente (criando-o se preciso) um encaminhamento — o que a regra 15
 * exige antes de qualquer requisição.
 *
 * Quase todo teste deste arquivo precisa disto no preparo, e nenhum deles é
 * sobre isto: o que eles testam é a unicidade do número, o reaproveitamento do
 * paciente e o rollback. Reaproveita `registrarEncaminhamentoNaTransacao` em
 * vez de inserir na mão para o preparo passar pelo mesmo get-or-create do
 * código de produção.
 */
async function comEncaminhamento(
  tx: ClienteDaTransacao,
  pacienteNome: string,
  dataEncaminhamento?: string,
): Promise<void> {
  const resultado = await registrarEncaminhamentoNaTransacao(tx, {
    pacienteNome,
    dataEncaminhamento:
      dataEncaminhamento ?? (await dataDeEncaminhamentoEmDia(tx)),
  });

  if (!resultado.ok) {
    throw new Error(`preparo falhou: ${resultado.erro}`);
  }
}

/** Quantos pacientes têm este nome, comparando como o índice compara. */
async function contarPacientes(
  cliente: ClienteDaTransacao | ReturnType<typeof getPrismaClient>,
  nome: string,
): Promise<number> {
  const [linha] = await cliente.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS "n" FROM "paciente" WHERE lower("nome") = lower(${nome})
  `;

  return linha.n;
}

describe.skipIf(!temBanco)("cadastro de requisicao contra o banco real", () => {
  beforeAll(async () => {
    // Abre a conexão fora do relógio da primeira transação.
    await getPrismaClient().$connect();
  });

  afterAll(async () => {
    await getPrismaClient().$disconnect();
  });

  it("pendura a requisição no paciente que o encaminhamento criou", async () => {
    const nome = `Paciente Novo ${SUFIXO}`;

    const resultado = await comRollback(async (tx) => {
      const terapiaId = await criarTerapia(tx, "novo");

      // Desde a regra 15 este é o único caminho para um paciente novo receber
      // requisição: o cadastro do encaminhamento é que o cria. Antes dela o
      // teste começava com o banco vazio e esperava `pacienteCriado: true`.
      await comEncaminhamento(tx, nome);

      const criacao = await criarRequisicaoNaTransacao(tx, {
        pacienteNome: nome,
        numeroRequisicao: `REQ-NOVO-${SUFIXO}`,
        linhas: [{ terapiaId, qtdAutorizada: 12, validade: "2026-12-31" }],
      });

      const pacientes = await contarPacientes(tx, nome);

      const guias = criacao.ok
        ? await tx.requisicaoTerapia.findMany({
            where: { requisicaoId: criacao.requisicaoId },
            select: { qtdAutorizada: true, validade: true },
          })
        : [];

      return { criacao, pacientes, guias };
    });

    // `pacienteCriado: false` não é detalhe: sob a regra 15 ele **nunca** é
    // `true` no sucesso. Um paciente recém-criado pelo get-or-create da
    // requisição não teria como já ter encaminhamento, e seria recusado antes
    // de chegar aqui.
    expect(resultado.criacao).toMatchObject({ ok: true, pacienteCriado: false });
    expect(resultado.pacientes).toBe(1);
    expect(resultado.guias).toEqual([
      {
        qtdAutorizada: 12,
        validade: new Date("2026-12-31T00:00:00.000Z"),
      },
    ]);
  });

  it("reaproveita o paciente existente mesmo com a caixa trocada", async () => {
    const nome = `Paciente Existente ${SUFIXO}`;

    const resultado = await comRollback(async (tx) => {
      const terapiaId = await criarTerapia(tx, "existente");

      await comEncaminhamento(tx, nome);

      const primeira = await criarRequisicaoNaTransacao(tx, {
        pacienteNome: nome,
        numeroRequisicao: `REQ-EXIST-A-${SUFIXO}`,
        linhas: [{ terapiaId, qtdAutorizada: 4, validade: null }],
      });

      // Mesma pessoa, digitada em caixa alta e com espaço sobrando: é a
      // comparação `lower(nome) = lower($1)` — a mesma do índice — que precisa
      // reconhecê-la.
      const segunda = await criarRequisicaoNaTransacao(tx, {
        pacienteNome: `  ${nome.toUpperCase()}  `,
        numeroRequisicao: `REQ-EXIST-B-${SUFIXO}`,
        linhas: [{ terapiaId, qtdAutorizada: 6, validade: null }],
      });

      const pacientes = await contarPacientes(tx, nome);

      const requisicoes = primeira.ok
        ? await tx.requisicao.findMany({
            where: {
              paciente: { requisicoes: { some: { id: primeira.requisicaoId } } },
            },
            select: { id: true, pacienteId: true },
            orderBy: { id: "asc" },
          })
        : [];

      return { primeira, segunda, pacientes, requisicoes };
    });

    expect(resultado.primeira).toMatchObject({
      ok: true,
      pacienteCriado: false,
    });
    expect(resultado.segunda).toMatchObject({
      ok: true,
      pacienteCriado: false,
    });
    // Uma linha só: o índice `UNIQUE (lower(nome))` e o get-or-create
    // concordaram.
    expect(resultado.pacientes).toBe(1);
    // E as duas requisições penduraram no mesmo paciente.
    expect(resultado.requisicoes).toHaveLength(2);
    expect(new Set(resultado.requisicoes.map((r) => r.pacienteId)).size).toBe(1);
  });

  it("acrescenta as terapias novas à requisição que o paciente já tem", async () => {
    const nome = `Paciente Mesma Pasta ${SUFIXO}`;
    const numero = `REQ-PASTA-${SUFIXO}`;

    const resultado = await comRollback(async (tx) => {
      const antiga = await criarTerapia(tx, "pasta-antiga");
      const novaA = await criarTerapia(tx, "pasta-nova-a");
      const novaB = await criarTerapia(tx, "pasta-nova-b");
      const novaC = await criarTerapia(tx, "pasta-nova-c");

      await comEncaminhamento(tx, nome);

      // Primeiro envio: número inédito para este paciente, uma terapia só.
      const primeira = await criarRequisicaoNaTransacao(tx, {
        pacienteNome: nome,
        numeroRequisicao: numero,
        linhas: [{ terapiaId: antiga, qtdAutorizada: 12, validade: null }],
      });

      // Segundo envio, semanas depois na vida real: mesmo paciente, mesmo
      // número, outras três terapias. Antes isto era recusado como duplicata.
      const segunda = await criarRequisicaoNaTransacao(tx, {
        pacienteNome: nome,
        numeroRequisicao: numero,
        linhas: [
          // Validade própria, perto de vencer: é o que prova que a validade é
          // por linha de `requisicao_terapia`, não da requisição — a terapia
          // antiga continua sem validade nenhuma.
          {
            terapiaId: novaA,
            qtdAutorizada: 4,
            validade: await dataEmDias(tx, 3),
          },
          { terapiaId: novaB, qtdAutorizada: 8, validade: null },
          { terapiaId: novaC, qtdAutorizada: 1, validade: null },
        ],
      });

      const [contagem] = await tx.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS "n"
        FROM "requisicao" r
        JOIN "paciente" p ON p."id" = r."paciente_id"
        WHERE lower(p."nome") = lower(${nome})
          AND r."numero_requisicao" = ${numero}
      `;

      const guias = primeira.ok
        ? await tx.requisicaoTerapia.findMany({
            where: { requisicaoId: primeira.requisicaoId },
            select: { id: true, terapiaId: true, qtdAutorizada: true },
            orderBy: { id: "asc" },
          })
        : [];

      // Atendimentos lançados **depois** do acréscimo, um numa guia antiga e
      // outro numa recém-criada: é o que faz a view ter o que calcular dos
      // dois lados.
      const hoje = await dataEmDias(tx, 0);

      for (const [terapiaId, creditos] of [
        [antiga, 10],
        [novaC, 1],
      ] as const) {
        const guia = guias.find((linha) => linha.terapiaId === terapiaId);

        if (guia) {
          await tx.atendimento.create({
            data: {
              requisicaoTerapiaId: guia.id,
              dataAtendimento: new Date(`${hoje}T00:00:00.000Z`),
              creditosConsumidos: creditos,
            },
          });
        }
      }

      const saldos = primeira.ok
        ? await tx.$queryRaw<
            {
              terapiaId: number;
              qtdUtilizada: number;
              saldoRestante: number;
              creditosPorSessao: string;
              statusAlerta: string;
            }[]
          >`
            SELECT
              "terapia_id"                 AS "terapiaId",
              "qtd_utilizada"              AS "qtdUtilizada",
              "saldo_restante"             AS "saldoRestante",
              "creditos_por_sessao"::text  AS "creditosPorSessao",
              "status_alerta"              AS "statusAlerta"
            FROM "requisicao_terapia_saldo"
            WHERE "requisicao_id" = ${primeira.requisicaoId}
            ORDER BY "id"
          `
        : [];

      return {
        primeira,
        segunda,
        contagem: contagem.n,
        guias,
        saldos,
        terapias: { antiga, novaA, novaB, novaC },
      };
    });

    expect(resultado.primeira).toMatchObject({
      ok: true,
      requisicaoCriada: true,
      terapiasAdicionadas: 1,
    });

    // O segundo envio é **sucesso**, e devolve o id da requisição que já
    // existia — não um id novo.
    expect(resultado.segunda).toMatchObject({
      ok: true,
      requisicaoCriada: false,
      terapiasAdicionadas: 3,
    });
    expect(
      resultado.segunda.ok ? resultado.segunda.requisicaoId : null,
    ).toBe(resultado.primeira.ok ? resultado.primeira.requisicaoId : undefined);

    // O ponto do teste: uma linha só em `requisicao` para o par
    // (paciente_id, numero_requisicao) — a unique nunca chegou a ser desafiada
    // —, e quatro em `requisicao_terapia` penduradas nela (1 + 3).
    expect(resultado.contagem).toBe(1);
    expect(resultado.guias).toHaveLength(4);
    expect(resultado.guias.map((guia) => guia.terapiaId)).toEqual([
      resultado.terapias.antiga,
      resultado.terapias.novaA,
      resultado.terapias.novaB,
      resultado.terapias.novaC,
    ]);

    // E a view calcula certo dos dois lados: a guia antiga (que ganhou
    // atendimento depois do acréscimo) e as recém-chegadas.
    const porTerapia = new Map(
      resultado.saldos.map((linha) => [linha.terapiaId, linha]),
    );

    // Antiga: 12 autorizados, 10 usados. Sobram 2, e 2 <= 12/4 -> Renovar.
    expect(porTerapia.get(resultado.terapias.antiga)).toMatchObject({
      qtdUtilizada: 10,
      saldoRestante: 2,
      statusAlerta: "Renovar",
    });
    // Nova A: saldo cheio, mas a validade cai dentro dos 7 dias -> Renovar.
    expect(porTerapia.get(resultado.terapias.novaA)).toMatchObject({
      qtdUtilizada: 0,
      saldoRestante: 4,
      statusAlerta: "Renovar",
    });
    // Nova B: 8 autorizados, nada usado, sem validade -> Regular.
    expect(porTerapia.get(resultado.terapias.novaB)).toMatchObject({
      qtdUtilizada: 0,
      saldoRestante: 8,
      statusAlerta: "Regular",
    });
    // Nova C: 1 autorizado e 1 usado -> saldo zero, Esgotada.
    expect(porTerapia.get(resultado.terapias.novaC)).toMatchObject({
      qtdUtilizada: 1,
      saldoRestante: 0,
      statusAlerta: "Esgotada",
    });
  });

  it("não grava nenhuma terapia nova quando uma linha do acréscimo falha", async () => {
    const nome = `Paciente Anexo Rollback ${SUFIXO}`;
    const numero = `REQ-ANEXO-ROLLBACK-${SUFIXO}`;

    // Como o teste do rollback da criação, este NÃO roda dentro da transação
    // do arquivo: o que está sob teste é a transação que `criarRequisicao`
    // abre sozinha, e o preparo precisa estar commitado para ela enxergá-lo.
    const terapia = await getPrismaClient().terapia.create({
      data: {
        nome: `Terapia Anexo Rollback ${SUFIXO}`,
        codigoTiss: `RAR${SUFIXO}`.slice(0, 10),
      },
      select: { id: true },
    });

    await getPrismaClient().$transaction(
      (tx) => comEncaminhamento(tx, nome),
      { maxWait: 30_000, timeout: 30_000 },
    );

    try {
      const primeira = await criarRequisicao({
        pacienteNome: nome,
        numeroRequisicao: numero,
        linhas: [{ terapiaId: terapia.id, qtdAutorizada: 4, validade: null }],
      });

      expect(primeira).toMatchObject({ ok: true, requisicaoCriada: true });

      /** Quantas guias a requisição tem agora, lidas do banco. */
      const contarGuias = async () =>
        getPrismaClient().requisicaoTerapia.count({
          where: { requisicao: { numeroRequisicao: numero } },
        });

      // Uma linha boa **antes** da ruim: o que o teste precisa provar é que a
      // boa também não entra, não só que a ruim é recusada.
      const comTerapiaInexistente = await criarRequisicao({
        pacienteNome: nome,
        numeroRequisicao: numero,
        linhas: [
          { terapiaId: terapia.id, qtdAutorizada: 6, validade: null },
          { terapiaId: TERAPIA_INEXISTENTE, qtdAutorizada: 6, validade: null },
        ],
      });

      expect(comTerapiaInexistente).toEqual({
        ok: false,
        erro: ERRO_TERAPIA_INEXISTENTE,
        linha: 1,
      });
      expect(await contarGuias()).toBe(1);

      // Mesma coisa pela outra porta: a quantidade inválida é recusada pela
      // validação sem banco, antes mesmo de a transação abrir.
      const comQuantidadeInvalida = await criarRequisicao({
        pacienteNome: nome,
        numeroRequisicao: numero,
        linhas: [
          { terapiaId: terapia.id, qtdAutorizada: 6, validade: null },
          { terapiaId: terapia.id, qtdAutorizada: 0, validade: null },
        ],
      });

      expect(comQuantidadeInvalida).toEqual({
        ok: false,
        erro: ERRO_QTD_INVALIDA,
        linha: 1,
      });
      expect(await contarGuias()).toBe(1);

      // E a requisição continua sendo uma só.
      expect(
        await getPrismaClient().requisicao.count({
          where: { numeroRequisicao: numero },
        }),
      ).toBe(1);
    } finally {
      await getPrismaClient().$executeRaw`
        DELETE FROM "requisicao_terapia"
        WHERE "requisicao_id" IN (
          SELECT "id" FROM "requisicao" WHERE "numero_requisicao" = ${numero}
        )
      `;
      await getPrismaClient().$executeRaw`
        DELETE FROM "requisicao" WHERE "numero_requisicao" = ${numero}
      `;
      await getPrismaClient().$executeRaw`
        DELETE FROM "encaminhamento"
        WHERE "paciente_id" IN (
          SELECT "id" FROM "paciente" WHERE lower("nome") = lower(${nome})
        )
      `;
      await getPrismaClient().$executeRaw`
        DELETE FROM "paciente" WHERE lower("nome") = lower(${nome})
      `;
      await getPrismaClient().$executeRaw`
        DELETE FROM "terapia" WHERE "id" = ${terapia.id}
      `;
    }
  });

  it("aceita o mesmo numero_requisicao em pacientes diferentes", async () => {
    const numero = `REQ-COMPARTILHADO-${SUFIXO}`;

    const resultado = await comRollback(async (tx) => {
      const terapiaId = await criarTerapia(tx, "compart");

      await comEncaminhamento(tx, `Paciente Um ${SUFIXO}`);
      await comEncaminhamento(tx, `Paciente Outro ${SUFIXO}`);

      const deUm = await criarRequisicaoNaTransacao(tx, {
        pacienteNome: `Paciente Um ${SUFIXO}`,
        numeroRequisicao: numero,
        linhas: [{ terapiaId, qtdAutorizada: 3, validade: null }],
      });

      const deOutro = await criarRequisicaoNaTransacao(tx, {
        pacienteNome: `Paciente Outro ${SUFIXO}`,
        numeroRequisicao: numero,
        linhas: [{ terapiaId, qtdAutorizada: 3, validade: null }],
      });

      const total = await tx.requisicao.count({
        where: { numeroRequisicao: numero },
      });

      return { deUm, deOutro, total };
    });

    // A unicidade é `(paciente_id, numero_requisicao)`, não `numero_requisicao`
    // sozinho: o mesmo número em outra pessoa é legítimo — e continua criando
    // uma requisição **própria**, não acrescentando terapias à do primeiro. É o
    // par que decide, e o segundo paciente não tem esse par.
    expect(resultado.deUm).toMatchObject({ ok: true, requisicaoCriada: true });
    expect(resultado.deOutro).toMatchObject({
      ok: true,
      requisicaoCriada: true,
    });
    expect(resultado.total).toBe(2);
  });

  it("desfaz a requisição inteira se uma terapia falhar", async () => {
    const nome = `Paciente Orfao ${SUFIXO}`;
    const numero = `REQ-ORFAO-${SUFIXO}`;

    // Este caso NÃO roda dentro da transação do teste de propósito: o que está
    // sob teste é justamente a transação que `criarRequisicao` abre sozinha.
    //
    // O preparo, porém, precisa estar **commitado** — a regra 15 exige que o
    // paciente já tenha encaminhamento, e um preparo dentro de uma transação
    // que sofre rollback não seria visto pela transação de `criarRequisicao`.
    // Daí o `finally` que limpa: é a única parte deste arquivo que escreve no
    // banco para valer.
    await getPrismaClient().$transaction(
      (tx) => comEncaminhamento(tx, nome),
      { maxWait: 30_000, timeout: 30_000 },
    );

    try {
      const terapiaValida = await getPrismaClient().terapia.findFirst({
        orderBy: { id: "asc" },
        select: { id: true },
      });

      const linhas = [
        // Uma linha boa antes da ruim (quando o seed tem alguma terapia), para
        // o teste cobrir mesmo "parte da lista já passou" e não só "a lista
        // toda era inválida".
        ...(terapiaValida
          ? [{ terapiaId: terapiaValida.id, qtdAutorizada: 5, validade: null }]
          : []),
        { terapiaId: TERAPIA_INEXISTENTE, qtdAutorizada: 5, validade: null },
      ];

      const resultado = await criarRequisicao({
        pacienteNome: nome,
        numeroRequisicao: numero,
        linhas,
      });

      expect(resultado).toEqual({
        ok: false,
        erro: ERRO_TERAPIA_INEXISTENTE,
        linha: linhas.length - 1,
      });

      // O ponto do teste: a primeira linha de terapia já tinha passado quando a
      // segunda falhou, e o `throw` levou a requisição junto. Nada da transação
      // que falhou sobrou.
      expect(
        await getPrismaClient().requisicao.count({
          where: { numeroRequisicao: numero },
        }),
      ).toBe(0);

      // E o rollback levou só o que aquela transação escreveu: o paciente é do
      // preparo, commitado antes, e continua de pé.
      expect(await contarPacientes(getPrismaClient(), nome)).toBe(1);
    } finally {
      await getPrismaClient().$executeRaw`
        DELETE FROM "encaminhamento"
        WHERE "paciente_id" IN (
          SELECT "id" FROM "paciente" WHERE lower("nome") = lower(${nome})
        )
      `;
      await getPrismaClient().$executeRaw`
        DELETE FROM "paciente" WHERE lower("nome") = lower(${nome})
      `;
    }
  });

  it("recusa qtd_autorizada <= 0 antes de criar qualquer paciente", async () => {
    const nome = `Paciente Qtd Invalida ${SUFIXO}`;

    const resultado = await criarRequisicao({
      pacienteNome: nome,
      numeroRequisicao: `REQ-QTD-${SUFIXO}`,
      linhas: [{ terapiaId: TERAPIA_INEXISTENTE, qtdAutorizada: 0, validade: null }],
    });

    expect(resultado).toMatchObject({ ok: false, linha: 0 });
    // A CHECK `requisicao_terapia_qtd_autorizada_positiva` existe como backstop,
    // mas nem chega a ser exercitada: a validação recusa antes da transação.
    expect(await contarPacientes(getPrismaClient(), nome)).toBe(0);
  });

  describe("encaminhamento obrigatório (regra 15)", () => {
    it("cria a requisição quando o encaminhamento está em dia", async () => {
      const nome = `Regra15 Em Dia ${SUFIXO}`;

      const resultado = await comRollback(async (tx) => {
        const terapiaId = await criarTerapia(tx, "r15dia");

        await comEncaminhamento(tx, nome);

        const criacao = await criarRequisicaoNaTransacao(tx, {
          pacienteNome: nome,
          numeroRequisicao: `REQ-R15-DIA-${SUFIXO}`,
          linhas: [{ terapiaId, qtdAutorizada: 8, validade: null }],
        });

        return { criacao };
      });

      expect(resultado.criacao).toMatchObject({ ok: true });
    });

    it("cria a requisição mesmo com o encaminhamento vencido", async () => {
      const nome = `Regra15 Vencido ${SUFIXO}`;

      const resultado = await comRollback(async (tx) => {
        const terapiaId = await criarTerapia(tx, "r15venc");

        // Literal, e bem no passado: 180 dias depois de 01/01/2020 é uma data
        // que já passou e vai continuar passada para sempre. É o oposto do
        // preparo padrão, que é relativo ao `CURRENT_DATE` justamente para
        // nunca vencer.
        await comEncaminhamento(tx, nome, "2020-01-01");

        // A prova de que o cenário é mesmo o vencido vem da view, não de conta
        // em JavaScript: se a classificação mudar, este teste para de dizer o
        // que promete e é aqui que se descobre.
        const [status] = await tx.$queryRaw<
          { statusEncaminhamento: string | null }[]
        >`
          SELECT s."status_encaminhamento" AS "statusEncaminhamento"
          FROM "encaminhamento_status" s
          JOIN "paciente" p ON p."id" = s."paciente_id"
          WHERE lower(p."nome") = lower(${nome})
        `;

        const criacao = await criarRequisicaoNaTransacao(tx, {
          pacienteNome: nome,
          numeroRequisicao: `REQ-R15-VENC-${SUFIXO}`,
          linhas: [{ terapiaId, qtdAutorizada: 8, validade: null }],
        });

        return { criacao, status };
      });

      expect(resultado.status.statusEncaminhamento).toBe("Vencido");
      // A regra é de existência, não de validade. Se um dia ela passar a exigir
      // "em dia", é este teste que cai — e é a conversa que ele obriga a ter.
      expect(resultado.criacao).toMatchObject({ ok: true });
    });

    it("recusa o paciente que já existe mas não tem encaminhamento", async () => {
      const nome = `Regra15 Sem Encaminhamento ${SUFIXO}`;

      const resultado = await comRollback(async (tx) => {
        const terapiaId = await criarTerapia(tx, "r15sem");

        // O paciente existe de verdade — só não tem encaminhamento. É o caso
        // que separa "não achei o paciente" de "achei e ele não pode".
        const paciente = await obterOuCriarPaciente(tx, nome);

        const criacao = await criarRequisicaoNaTransacao(tx, {
          pacienteNome: nome,
          numeroRequisicao: `REQ-R15-SEM-${SUFIXO}`,
          linhas: [{ terapiaId, qtdAutorizada: 8, validade: null }],
        });

        const requisicoes = await tx.requisicao.count({
          where: { pacienteId: paciente.id },
        });

        return { criacao, requisicoes };
      });

      expect(resultado.criacao).toEqual({
        ok: false,
        erro: ERRO_SEM_ENCAMINHAMENTO,
        linha: undefined,
      });
      expect(resultado.requisicoes).toBe(0);
    });

    it("recusa o nome novo sem criar o paciente", async () => {
      const nome = `Regra15 Nome Nunca Visto ${SUFIXO}`;
      const numero = `REQ-R15-NOVO-${SUFIXO}`;

      // Pelo caminho real, com transação própria: o que está sob teste é o
      // rollback. O get-or-create **chega a inserir** este paciente lá dentro,
      // e é o `throw` do erro de negócio que o desfaz. Se a checagem devolvesse
      // `{ ok: false }` educadamente, sobraria um paciente órfão — sem
      // requisição, sem encaminhamento, e impedido de receber os dois.
      const terapiaValida = await getPrismaClient().terapia.findFirst({
        orderBy: { id: "asc" },
        select: { id: true },
      });

      const resultado = await criarRequisicao({
        pacienteNome: nome,
        numeroRequisicao: numero,
        linhas: [
          {
            terapiaId: terapiaValida?.id ?? TERAPIA_INEXISTENTE,
            qtdAutorizada: 8,
            validade: null,
          },
        ],
      });

      expect(resultado).toEqual({
        ok: false,
        erro: ERRO_SEM_ENCAMINHAMENTO,
        linha: undefined,
      });
      expect(await contarPacientes(getPrismaClient(), nome)).toBe(0);
      expect(
        await getPrismaClient().requisicao.count({
          where: { numeroRequisicao: numero },
        }),
      ).toBe(0);
    });
  });
});

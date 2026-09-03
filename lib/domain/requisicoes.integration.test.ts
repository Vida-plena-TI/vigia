/**
 * Contraparte de `requisicoes.test.ts` contra o Postgres real.
 *
 * O teste unitário prova que o nosso código decide certo; este prova que o
 * banco concorda — que o `ON CONFLICT (lower("nome"))` reaproveita mesmo o
 * paciente escrito com outra caixa, que a unique
 * `(paciente_id, numero_requisicao)` é por paciente e não global, e que uma
 * linha de terapia ruim leva a transação inteira embora.
 *
 * Como roda (mesmo contrato de `guias.integration.test.ts`):
 *   - precisa de DATABASE_URL com as migrations aplicadas; sem ela o bloco é
 *     pulado em vez de falhar;
 *   - o que grava com sucesso roda dentro de uma transação que sempre sofre
 *     rollback, então o banco de desenvolvimento não fica com lixo.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getPrismaClient } from "@/lib/db";

import {
  criarRequisicao,
  criarRequisicaoNaTransacao,
  ERRO_TERAPIA_INEXISTENTE,
  erroNumeroDuplicado,
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

  it("cria o paciente quando ele ainda não existe", async () => {
    const nome = `Paciente Novo ${SUFIXO}`;

    const resultado = await comRollback(async (tx) => {
      const terapiaId = await criarTerapia(tx, "novo");

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

    expect(resultado.criacao).toMatchObject({ ok: true, pacienteCriado: true });
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

    expect(resultado.primeira).toMatchObject({ ok: true, pacienteCriado: true });
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

  it("recusa o mesmo numero_requisicao no mesmo paciente", async () => {
    const nome = `Paciente Numero Repetido ${SUFIXO}`;
    const numero = `REQ-DUP-${SUFIXO}`;

    const resultado = await comRollback(async (tx) => {
      const terapiaId = await criarTerapia(tx, "dup");

      const primeira = await criarRequisicaoNaTransacao(tx, {
        pacienteNome: nome,
        numeroRequisicao: numero,
        linhas: [{ terapiaId, qtdAutorizada: 5, validade: null }],
      });

      const segunda = await criarRequisicaoNaTransacao(tx, {
        pacienteNome: nome,
        numeroRequisicao: numero,
        linhas: [{ terapiaId, qtdAutorizada: 5, validade: null }],
      });

      const total = await tx.requisicao.count({
        where: { numeroRequisicao: numero },
      });

      return { primeira, segunda, total };
    });

    expect(resultado.primeira).toMatchObject({ ok: true });
    expect(resultado.segunda).toEqual({
      ok: false,
      erro: erroNumeroDuplicado(numero, nome),
      linha: undefined,
    });
    // A segunda tentativa não gravou nada: continua havendo uma requisição só.
    expect(resultado.total).toBe(1);
  });

  it("aceita o mesmo numero_requisicao em pacientes diferentes", async () => {
    const numero = `REQ-COMPARTILHADO-${SUFIXO}`;

    const resultado = await comRollback(async (tx) => {
      const terapiaId = await criarTerapia(tx, "compart");

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
    // sozinho: o mesmo número em outra pessoa é legítimo.
    expect(resultado.deUm).toMatchObject({ ok: true });
    expect(resultado.deOutro).toMatchObject({ ok: true });
    expect(resultado.total).toBe(2);
  });

  it("desfaz tudo — inclusive o paciente novo — se uma terapia falhar", async () => {
    const nome = `Paciente Orfao ${SUFIXO}`;
    const numero = `REQ-ORFAO-${SUFIXO}`;

    // Este caso NÃO roda dentro da transação do teste de propósito: o que está
    // sob teste é justamente a transação que `criarRequisicao` abre sozinha.
    // Como ela termina em falha, nada é commitado — não há lixo para limpar.
    const terapiaValida = await getPrismaClient().terapia.findFirst({
      orderBy: { id: "asc" },
      select: { id: true },
    });

    const linhas = [
      // Uma linha boa antes da ruim (quando o seed tem alguma terapia), para o
      // teste cobrir mesmo "parte da lista já passou" e não só "a lista toda
      // era inválida".
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

    // O ponto do teste: o paciente chegou a ser inserido dentro da transação e
    // o rollback o levou junto. Se `criarNaTransacao` devolvesse `{ ok: false }`
    // em vez de lançar, esta contagem seria 1.
    expect(await contarPacientes(getPrismaClient(), nome)).toBe(0);

    expect(
      await getPrismaClient().requisicao.count({ where: { numeroRequisicao: numero } }),
    ).toBe(0);
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
});

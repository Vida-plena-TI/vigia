/**
 * O cadastro de encaminhamento contra o Postgres real.
 *
 * Este arquivo carrega a prova da única regra de negócio da feature: o
 * vencimento é **180 dias corridos** depois do encaminhamento, e não seis meses
 * de calendário. A distinção não é acadêmica — a planilha de referência do
 * usuário usa seis meses, e os dois resultados são datas diferentes na maior
 * parte do ano. Por isso um dos testes compara, no mesmo SELECT, o que a coluna
 * gerada produziu com o que `+ INTERVAL '6 months'` produziria: se alguém um dia
 * "corrigir" a migration para bater com a planilha, é este teste que cai.
 *
 * Nenhuma expectativa aqui é calculada em JavaScript. As datas esperadas são
 * literais conferidas à mão, justamente para o teste não repetir a fórmula que
 * ele deveria estar verificando.
 *
 * Como roda (mesmo contrato de `requisicoes.integration.test.ts`):
 *   - precisa de DATABASE_URL com as migrations aplicadas; sem ela o bloco é
 *     pulado em vez de falhar;
 *   - tudo roda dentro de uma transação que sempre sofre rollback, então o
 *     banco não fica com lixo.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getPrismaClient } from "@/lib/db";

import { criarEncaminhamentoNaTransacao } from "./encaminhamentos";

const temBanco = Boolean(process.env.DATABASE_URL);

/** Sufixo único para não colidir com paciente já existente. */
const SUFIXO = Math.random().toString(36).slice(2, 10);

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

/** Quantos pacientes têm este nome, comparando como o índice compara. */
async function contarPacientes(
  tx: ClienteDaTransacao,
  nome: string,
): Promise<number> {
  const [linha] = await tx.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS "n" FROM "paciente" WHERE lower("nome") = lower(${nome})
  `;

  return linha.n;
}

describe.skipIf(!temBanco)("encaminhamento contra o banco real", () => {
  beforeAll(async () => {
    // Abre a conexão fora do relógio da primeira transação.
    await getPrismaClient().$connect();
  });

  afterAll(async () => {
    await getPrismaClient().$disconnect();
  });

  /**
   * Cada caso é `[rótulo, data do encaminhamento, vencimento esperado]`.
   *
   * As três datas esperadas foram contadas à mão, dia a dia:
   *
   *   - `2026-01-01` -> `2026-06-30`. É o caso que separa as duas regras:
   *     seis meses de calendário dariam `2026-07-01`. O primeiro semestre de
   *     um ano não bissexto tem 181 dias, então 180 dias param um dia antes.
   *   - `2026-11-15` -> `2027-05-14`. Atravessa a virada do ano (15 dias de
   *     novembro + 31 + 31 + 28 + 31 + 30 + 14).
   *   - `2027-11-15` -> `2028-05-13`. Também atravessa a virada, mas passando
   *     por um fevereiro de 29 dias — daí um dia a menos que o caso anterior.
   *     Seis meses de calendário dariam `2028-05-15` nos dois.
   *   - `2028-02-29` -> `2028-08-27`. Começa no próprio dia extra do ano
   *     bissexto, onde "somar meses" nem sempre tem resposta óbvia.
   */
  const CASOS: ReadonlyArray<readonly [string, string, string]> = [
    ["primeiro dia do ano", "2026-01-01", "2026-06-30"],
    ["virada de ano", "2026-11-15", "2027-05-14"],
    ["virada de ano passando por fevereiro bissexto", "2027-11-15", "2028-05-13"],
    ["29 de fevereiro", "2028-02-29", "2028-08-27"],
  ];

  it.each(CASOS)(
    "a coluna gerada soma 180 dias corridos (%s)",
    async (rotulo, dataEncaminhamento, vencimentoEsperado) => {
      const resultado = await comRollback((tx) =>
        criarEncaminhamentoNaTransacao(tx, {
          pacienteNome: `Encaminhado ${rotulo} ${SUFIXO}`,
          dataEncaminhamento,
        }),
      );

      expect(resultado).toMatchObject({
        ok: true,
        dataEncaminhamento,
        dataVencimento: vencimentoEsperado,
      });
    },
  );

  it("os 180 dias corridos NÃO são seis meses de calendário", async () => {
    // A comparação é feita pelo próprio Postgres, com a linha já gravada: de um
    // lado a coluna gerada, do outro o que a regra da planilha antiga daria. O
    // JavaScript aqui não soma nada, só confere que as duas discordam e que a
    // que vale é a de 180 dias.
    const linhas = await comRollback(async (tx) => {
      const criacao = await criarEncaminhamentoNaTransacao(tx, {
        pacienteNome: `Encaminhado Seis Meses ${SUFIXO}`,
        dataEncaminhamento: "2026-01-01",
      });

      if (!criacao.ok) {
        throw new Error(`criacao falhou: ${criacao.erro}`);
      }

      return tx.$queryRaw<
        {
          gerada: string;
          seisMeses: string;
          centoEOitentaDias: string;
        }[]
      >`
        SELECT
          "data_vencimento"::text                                    AS "gerada",
          ("data_encaminhamento" + INTERVAL '6 months')::date::text   AS "seisMeses",
          ("data_encaminhamento" + INTERVAL '180 days')::date::text   AS "centoEOitentaDias"
        FROM "encaminhamento"
        WHERE "id" = ${criacao.id}
      `;
    });

    expect(linhas).toHaveLength(1);
    const [linha] = linhas;

    expect(linha.gerada).toBe(linha.centoEOitentaDias);
    expect(linha.gerada).not.toBe(linha.seisMeses);
    expect(linha.gerada).toBe("2026-06-30");
    expect(linha.seisMeses).toBe("2026-07-01");
  });

  it("o banco recusa qualquer tentativa de gravar o vencimento à mão", async () => {
    // O que garante "uma única fonte de verdade" não é convenção nem revisão de
    // código: é o `GENERATED ALWAYS`. Um dia alguém vai tentar calcular a data
    // em TypeScript e mandá-la no INSERT — e vai receber um erro do Postgres,
    // não uma linha errada em silêncio.
    const erro = await comRollback(async (tx) => {
      const [paciente] = await tx.$queryRaw<{ id: number }[]>`
        INSERT INTO "paciente" ("nome")
        VALUES (${`Encaminhado Escrita Proibida ${SUFIXO}`})
        RETURNING "id"
      `;

      try {
        await tx.$executeRaw`
          INSERT INTO "encaminhamento"
            ("paciente_id", "data_encaminhamento", "data_vencimento")
          VALUES (${paciente.id}, '2026-01-01'::date, '2026-07-01'::date)
        `;
      } catch (falha) {
        return String(falha);
      }

      return null;
    });

    expect(erro).not.toBeNull();
    // 428C9: cannot insert into a generated column.
    expect(erro).toMatch(/428C9|generated column|data_vencimento/i);
  });

  it("cria o paciente quando ele ainda não existe", async () => {
    const nome = `Encaminhado Paciente Novo ${SUFIXO}`;

    const resultado = await comRollback(async (tx) => {
      const criacao = await criarEncaminhamentoNaTransacao(tx, {
        pacienteNome: nome,
        dataEncaminhamento: "2026-11-15",
      });

      return { criacao, pacientes: await contarPacientes(tx, nome) };
    });

    expect(resultado.criacao).toMatchObject({
      ok: true,
      pacienteNome: nome,
      pacienteCriado: true,
      dataVencimento: "2027-05-14",
    });
    expect(resultado.pacientes).toBe(1);
  });

  it("reaproveita o paciente existente mesmo com a caixa trocada", async () => {
    const nome = `Encaminhado Paciente Existente ${SUFIXO}`;

    const resultado = await comRollback(async (tx) => {
      const primeiro = await criarEncaminhamentoNaTransacao(tx, {
        pacienteNome: nome,
        dataEncaminhamento: "2026-11-15",
      });

      // Mesma pessoa, digitada em caixa alta e com espaço sobrando: é a
      // comparação `lower(nome) = lower($1)` — a mesma do índice — que precisa
      // reconhecê-la. É o get-or-create de `lib/domain/pacientes.ts`, o mesmo
      // que o cadastro de requisição usa.
      const segundo = await criarEncaminhamentoNaTransacao(tx, {
        pacienteNome: `  ${nome.toUpperCase()}  `,
        dataEncaminhamento: "2026-12-01",
      });

      const donos = await tx.$queryRaw<{ pacienteId: number }[]>`
        SELECT DISTINCT e."paciente_id" AS "pacienteId"
        FROM "encaminhamento" e
        JOIN "paciente" p ON p."id" = e."paciente_id"
        WHERE lower(p."nome") = lower(${nome})
      `;

      return { primeiro, segundo, donos, pacientes: await contarPacientes(tx, nome) };
    });

    expect(resultado.primeiro).toMatchObject({
      ok: true,
      pacienteCriado: true,
      dataVencimento: "2027-05-14",
    });
    // O nome devolvido é o que já estava no banco, não o que foi digitado em
    // caixa alta: o get-or-create reaproveitou a linha existente.
    expect(resultado.segundo).toMatchObject({
      ok: true,
      pacienteNome: nome,
      pacienteCriado: false,
      dataVencimento: "2027-05-30",
    });
    // Uma linha só de paciente, e os dois encaminhamentos pendurados nela.
    expect(resultado.pacientes).toBe(1);
    expect(resultado.donos).toHaveLength(1);
  });
});

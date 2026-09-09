/**
 * O cadastro de encaminhamento contra o Postgres real.
 *
 * Este arquivo carrega a prova das três regras da feature, e as três moram no
 * banco — nenhuma expectativa aqui é calculada em JavaScript:
 *
 *   1. **180 dias corridos**, não seis meses de calendário (coluna gerada
 *      `data_vencimento`). A distinção não é acadêmica: a planilha de
 *      referência do usuário usa seis meses, e os dois resultados são datas
 *      diferentes na maior parte do ano. Por isso um dos testes compara, no
 *      mesmo SELECT, o que a coluna gerada produziu com o que
 *      `+ INTERVAL '6 months'` produziria — se alguém um dia "corrigir" a
 *      migration para bater com a planilha, é este teste que cai. As datas
 *      esperadas são literais conferidas à mão, para o teste não repetir a
 *      fórmula que ele deveria estar verificando.
 *   2. **Um encaminhamento por paciente**: cadastrar outro substitui o
 *      anterior (UNIQUE em `paciente_id` + `ON CONFLICT DO UPDATE`).
 *   3. **Status por mês de calendário**, não por dias (view
 *      `encaminhamento_status`). As fronteiras de mês são testadas
 *      explicitamente, e relativas ao `CURRENT_DATE` do banco — um teste com
 *      datas fixas passaria a mentir no mês seguinte.
 *
 * Como roda (mesmo contrato de `requisicoes.integration.test.ts`):
 *   - precisa de DATABASE_URL com as migrations aplicadas; sem ela o bloco é
 *     pulado em vez de falhar;
 *   - tudo roda dentro de uma transação que sempre sofre rollback, então o
 *     banco não fica com lixo.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getPrismaClient } from "@/lib/db";

import {
  registrarEncaminhamentoNaTransacao,
  type StatusEncaminhamento,
} from "./encaminhamentos";

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

/** As linhas de encaminhamento que pertencem ao paciente de nome `nome`. */
async function encaminhamentosDoPaciente(
  tx: ClienteDaTransacao,
  nome: string,
): Promise<
  { id: number; dataEncaminhamento: string; dataVencimento: string }[]
> {
  return tx.$queryRaw`
    SELECT
      e."id"                        AS "id",
      e."data_encaminhamento"::text AS "dataEncaminhamento",
      e."data_vencimento"::text     AS "dataVencimento"
    FROM "encaminhamento" e
    JOIN "paciente" p ON p."id" = e."paciente_id"
    WHERE lower(p."nome") = lower(${nome})
    ORDER BY e."id"
  `;
}

/** O status que a view atribuiu a uma linha já gravada. */
async function statusDaView(
  tx: ClienteDaTransacao,
  id: number,
): Promise<string | null> {
  const [linha] = await tx.$queryRaw<{ status: string | null }[]>`
    SELECT "status_encaminhamento" AS "status"
    FROM "encaminhamento_status"
    WHERE "id" = ${id}
  `;

  return linha.status;
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
        registrarEncaminhamentoNaTransacao(tx, {
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
      const gravacao = await registrarEncaminhamentoNaTransacao(tx, {
        pacienteNome: `Encaminhado Seis Meses ${SUFIXO}`,
        dataEncaminhamento: "2026-01-01",
      });

      if (!gravacao.ok) {
        throw new Error(`gravacao falhou: ${gravacao.erro}`);
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
        WHERE "id" = ${gravacao.id}
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
      const gravacao = await registrarEncaminhamentoNaTransacao(tx, {
        pacienteNome: nome,
        dataEncaminhamento: "2026-11-15",
      });

      return { gravacao, pacientes: await contarPacientes(tx, nome) };
    });

    expect(resultado.gravacao).toMatchObject({
      ok: true,
      pacienteNome: nome,
      pacienteCriado: true,
      substituiuAnterior: false,
      dataVencimento: "2027-05-14",
    });
    expect(resultado.pacientes).toBe(1);
  });

  it("reaproveita o paciente existente mesmo com a caixa trocada", async () => {
    const nome = `Encaminhado Paciente Existente ${SUFIXO}`;

    const resultado = await comRollback(async (tx) => {
      const primeiro = await registrarEncaminhamentoNaTransacao(tx, {
        pacienteNome: nome,
        dataEncaminhamento: "2026-11-15",
      });

      // Mesma pessoa, digitada em caixa alta e com espaço sobrando: é a
      // comparação `lower(nome) = lower($1)` — a mesma do índice — que precisa
      // reconhecê-la. É o get-or-create de `lib/domain/pacientes.ts`, o mesmo
      // que o cadastro de requisição usa.
      const segundo = await registrarEncaminhamentoNaTransacao(tx, {
        pacienteNome: `  ${nome.toUpperCase()}  `,
        dataEncaminhamento: "2026-12-01",
      });

      const donos = await tx.$queryRaw<{ pacienteId: number }[]>`
        SELECT DISTINCT e."paciente_id" AS "pacienteId"
        FROM "encaminhamento" e
        JOIN "paciente" p ON p."id" = e."paciente_id"
        WHERE lower(p."nome") = lower(${nome})
      `;

      return {
        primeiro,
        segundo,
        donos,
        pacientes: await contarPacientes(tx, nome),
      };
    });

    expect(resultado.primeiro).toMatchObject({
      ok: true,
      pacienteCriado: true,
      substituiuAnterior: false,
      dataVencimento: "2027-05-14",
    });
    // O nome devolvido é o que já estava no banco, não o que foi digitado em
    // caixa alta: o get-or-create reaproveitou a linha existente. E, como o
    // paciente é o mesmo, o segundo cadastro *substituiu* o primeiro.
    expect(resultado.segundo).toMatchObject({
      ok: true,
      pacienteNome: nome,
      pacienteCriado: false,
      substituiuAnterior: true,
      dataVencimento: "2027-05-30",
    });
    // Uma linha só de paciente, e um encaminhamento só pendurado nela.
    expect(resultado.pacientes).toBe(1);
    expect(resultado.donos).toHaveLength(1);
  });

  it("o segundo encaminhamento do mesmo paciente substitui o primeiro", async () => {
    const nome = `Encaminhado Substituicao ${SUFIXO}`;

    const resultado = await comRollback(async (tx) => {
      const primeiro = await registrarEncaminhamentoNaTransacao(tx, {
        pacienteNome: nome,
        dataEncaminhamento: "2026-01-01",
      });

      const segundo = await registrarEncaminhamentoNaTransacao(tx, {
        pacienteNome: nome,
        dataEncaminhamento: "2026-11-15",
      });

      return { primeiro, segundo, linhas: await encaminhamentosDoPaciente(tx, nome) };
    });

    expect(resultado.primeiro).toMatchObject({
      ok: true,
      substituiuAnterior: false,
      dataEncaminhamento: "2026-01-01",
      dataVencimento: "2026-06-30",
    });

    expect(resultado.segundo).toMatchObject({
      ok: true,
      substituiuAnterior: true,
      dataEncaminhamento: "2026-11-15",
      // Vencimento **recalculado** pelo banco: o UPDATE só toca em
      // `data_encaminhamento`, e a coluna gerada se refaz sozinha. Literal
      // conferido à mão, como os demais.
      dataVencimento: "2027-05-14",
    });

    // O ponto do teste: sobra **exatamente uma** linha para aquele paciente, e
    // é a do cadastro mais recente. Não é a aplicação que garante isso — é a
    // UNIQUE em `paciente_id`, que faz o segundo INSERT virar UPDATE.
    expect(resultado.linhas).toHaveLength(1);
    expect(resultado.linhas[0]).toMatchObject({
      dataEncaminhamento: "2026-11-15",
      dataVencimento: "2027-05-14",
    });
  });

  it("dois pacientes diferentes têm cada um o seu, sem conflito", async () => {
    // A UNIQUE é por paciente, não global: substituir o encaminhamento de um
    // não pode encostar no do outro. O caso importa porque a chave de conflito
    // do upsert é `paciente_id` — se ela fosse mais ampla por engano, é aqui
    // que apareceria.
    const primeiroNome = `Encaminhado Vizinho A ${SUFIXO}`;
    const segundoNome = `Encaminhado Vizinho B ${SUFIXO}`;

    const resultado = await comRollback(async (tx) => {
      const a = await registrarEncaminhamentoNaTransacao(tx, {
        pacienteNome: primeiroNome,
        dataEncaminhamento: "2026-01-01",
      });

      const b = await registrarEncaminhamentoNaTransacao(tx, {
        pacienteNome: segundoNome,
        dataEncaminhamento: "2026-11-15",
      });

      // E o de A ainda pode ser substituído sem afetar o de B.
      const aDeNovo = await registrarEncaminhamentoNaTransacao(tx, {
        pacienteNome: primeiroNome,
        dataEncaminhamento: "2028-02-29",
      });

      return {
        a,
        b,
        aDeNovo,
        linhasDeA: await encaminhamentosDoPaciente(tx, primeiroNome),
        linhasDeB: await encaminhamentosDoPaciente(tx, segundoNome),
      };
    });

    expect(resultado.a).toMatchObject({ ok: true, substituiuAnterior: false });
    expect(resultado.b).toMatchObject({ ok: true, substituiuAnterior: false });
    expect(resultado.aDeNovo).toMatchObject({
      ok: true,
      substituiuAnterior: true,
    });

    expect(resultado.linhasDeA).toHaveLength(1);
    expect(resultado.linhasDeA[0]).toMatchObject({
      dataEncaminhamento: "2028-02-29",
      dataVencimento: "2028-08-27",
    });

    // B ficou intacto: nem a data nem o vencimento se moveram.
    expect(resultado.linhasDeB).toHaveLength(1);
    expect(resultado.linhasDeB[0]).toMatchObject({
      dataEncaminhamento: "2026-11-15",
      dataVencimento: "2027-05-14",
    });
  });

  /**
   * As fronteiras de mês do `status_encaminhamento`.
   *
   * O status compara **mês de calendário**, não número de dias — é a diferença
   * entre esta view e o alerta de validade da guia, que conta dias. As
   * fronteiras que importam são todas relativas ao mês atual, então os alvos
   * são calculados pelo próprio banco a partir do `CURRENT_DATE`: datas fixas
   * fariam o teste passar hoje e mentir no mês que vem.
   *
   * Cada caso é `[rótulo, expressão SQL do vencimento alvo, status esperado]`.
   * O primeiro e o último dia do mês atual estão os dois na lista de propósito:
   * eles estão a quase um mês de distância um do outro e mesmo assim precisam
   * dar a **mesma** resposta — é justamente isso que uma comparação por dias
   * erraria.
   */
  const FRONTEIRAS: ReadonlyArray<
    readonly [string, string, StatusEncaminhamento | null]
  > = [
    [
      "último dia do mês anterior",
      "date_trunc('month', CURRENT_DATE)::date - 1",
      "Vencido",
    ],
    [
      "primeiro dia do mês atual",
      "date_trunc('month', CURRENT_DATE)::date",
      "Vence este mês",
    ],
    [
      "último dia do mês atual",
      "(date_trunc('month', CURRENT_DATE) + INTERVAL '1 month')::date - 1",
      "Vence este mês",
    ],
    [
      "primeiro dia do mês seguinte",
      "(date_trunc('month', CURRENT_DATE) + INTERVAL '1 month')::date",
      "A vencer",
    ],
    [
      "primeiro dia de dois meses à frente",
      "(date_trunc('month', CURRENT_DATE) + INTERVAL '2 months')::date",
      null,
    ],
  ];

  it.each(FRONTEIRAS)(
    "classifica pelo mês do vencimento (%s)",
    async (rotulo, expressaoDoAlvo, statusEsperado) => {
      const resultado = await comRollback(async (tx) => {
        // Para pousar o vencimento num dia específico é preciso andar para
        // trás os mesmos 180 dias — é a inversa da regra da coluna gerada, e
        // ela serve só para *posicionar* a linha. O teste não confia nessa
        // conta: logo abaixo ele confere que o `data_vencimento` que o banco
        // gerou caiu exatamente no alvo. Se a regra dos 180 dias mudar, esta
        // asserção cai antes da do status, em vez de o teste passar a
        // classificar silenciosamente um mês que não é o pretendido.
        //
        // `$queryRawUnsafe` porque o que varia é um pedaço de **SQL**, não um
        // valor: `expressaoDoAlvo` é uma constante do próprio arquivo de
        // teste, nunca entrada de usuário.
        const [datas] = await tx.$queryRawUnsafe<
          { alvo: string; encaminhamento: string }[]
        >(
          `SELECT (${expressaoDoAlvo})::text        AS "alvo",
                  ((${expressaoDoAlvo}) - 180)::text AS "encaminhamento"`,
        );

        const gravacao = await registrarEncaminhamentoNaTransacao(tx, {
          pacienteNome: `Encaminhado Fronteira ${rotulo} ${SUFIXO}`,
          dataEncaminhamento: datas.encaminhamento,
        });

        if (!gravacao.ok) {
          throw new Error(`gravacao falhou: ${gravacao.erro}`);
        }

        return {
          alvo: datas.alvo,
          dataVencimento: gravacao.dataVencimento,
          status: await statusDaView(tx, gravacao.id),
        };
      });

      expect(resultado.dataVencimento).toBe(resultado.alvo);
      expect(resultado.status).toBe(statusEsperado);
    },
  );
});

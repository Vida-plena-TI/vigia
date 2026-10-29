/**
 * Cadastro de paciente com convênio e plano de terapias, contra o Postgres
 * real.
 *
 * Como roda (mesmo contrato dos outros `*.integration.test.ts`):
 *   - precisa de DATABASE_URL com as migrations aplicadas; sem ela o bloco é
 *     pulado;
 *   - quase tudo roda numa transação que sempre sofre rollback;
 *   - **os dois testes de atomicidade não podem**: para provar que a transação
 *     de produção desfez o paciente, ela precisa commitar ou falhar de verdade.
 *     Eles limpam o que sobrar num `finally`, pelo nome com sufixo aleatório.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getPrismaClient } from "@/lib/db";

import { excluirPacienteNaTransacao } from "./pacientes";
import {
  ERRO_OUTRO_CONVENIO,
  ERRO_SEM_TERAPIA,
  ERRO_TERAPIA_INEXISTENTE,
  ERRO_TERAPIA_REPETIDA,
  cadastrarPaciente,
  cadastrarPacienteNaTransacao,
  listarPacientesDoConvenioComCliente,
  planoDoPacienteComCliente,
  type EntradaCadastroDePaciente,
} from "./plano-terapias";

const temBanco = Boolean(process.env.DATABASE_URL);

const SUFIXO = Math.random().toString(36).slice(2, 10);

const CAMINHO_DA_MIGRATION = join(
  __dirname,
  "../../prisma/migrations/20261029120000_convenio_e_plano_de_terapias/migration.sql",
);

/** Um id de terapia que não existe (int4 válido, longe do serial). */
const TERAPIA_INEXISTENTE = 2_000_000_000;

class Rollback<T> extends Error {
  constructor(readonly dados: T) {
    super("rollback proposital do teste de integracao");
  }
}

class ErroInjetado extends Error {
  constructor() {
    super("falha injetada depois de criar o paciente");
    this.name = "ErroInjetado";
  }
}

type ClienteDaTransacao = Parameters<
  Parameters<ReturnType<typeof getPrismaClient>["$transaction"]>[0]
>[0];

const OPCOES = { maxWait: 30_000, timeout: 30_000 };

async function comRollback<T>(
  executar: (tx: ClienteDaTransacao) => Promise<T>,
): Promise<T> {
  try {
    await getPrismaClient().$transaction(async (tx) => {
      throw new Rollback(await executar(tx));
    }, OPCOES);
  } catch (erro) {
    if (erro instanceof Rollback) {
      return erro.dados as T;
    }
    throw erro;
  }

  throw new Error("a transacao deveria ter sofrido rollback");
}

/** Duas terapias novas, só desta transação. */
async function terapiasDeTeste(
  tx: ClienteDaTransacao,
  rotulo: string,
): Promise<number[]> {
  const terapias = await tx.terapia.createManyAndReturn({
    data: ["A", "B", "C"].map((letra) => ({
      nome: `Plano ${letra} ${rotulo} ${SUFIXO}`,
      codigoTiss: `PL${letra}${rotulo}`.slice(0, 10),
    })),
    select: { id: true },
  });

  return terapias.map((terapia) => terapia.id);
}

/** Insere um paciente cru (sem o domínio), com o convênio dado. */
async function inserirPacienteCru(
  tx: ClienteDaTransacao,
  nome: string,
  convenio: string | null,
): Promise<number> {
  const [paciente] = await tx.$queryRaw<{ id: number }[]>`
    INSERT INTO "paciente" ("nome", "convenio") VALUES (${nome}, ${convenio}) RETURNING "id"
  `;

  return paciente.id;
}

/** O plano gravado, lido à mão (não pela função sob teste). */
async function planoCru(
  tx: ClienteDaTransacao,
  pacienteId: number,
): Promise<{ terapiaId: number; minutos: number }[]> {
  return tx.$queryRaw`
    SELECT "terapia_id" AS "terapiaId", "minutos_semanais" AS "minutos"
    FROM "plano_terapia" WHERE "paciente_id" = ${pacienteId}
    ORDER BY "terapia_id"
  `;
}

async function pacientesComONome(
  cliente: Pick<ClienteDaTransacao, "$queryRaw">,
  nome: string,
): Promise<{ id: number; nome: string; convenio: string | null }[]> {
  return cliente.$queryRaw`
    SELECT "id", "nome", "convenio" FROM "paciente" WHERE lower("nome") = lower(${nome.trim()})
  `;
}

/**
 * Roda um comando cru num `SAVEPOINT` e devolve SQLSTATE e constraint da
 * recusa (ou `null` se o banco aceitou) — mesmo helper de
 * `carteirinha-crm.integration.test.ts`.
 */
async function tentarNoBanco(
  tx: ClienteDaTransacao,
  comando: (tx: ClienteDaTransacao) => Promise<unknown>,
): Promise<{ codigo: string; constraint: string } | null> {
  await tx.$executeRaw`SAVEPOINT "tentativa"`;

  try {
    await comando(tx);
    await tx.$executeRaw`RELEASE SAVEPOINT "tentativa"`;
    return null;
  } catch (erro) {
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT "tentativa"`;

    const meta = JSON.stringify((erro as { meta?: unknown }).meta ?? {});
    const codigo = /"originalCode":"(\w+)"/.exec(meta)?.[1] ?? "?";
    const constraint =
      /(plano_terapia_minutos_semanais_validos|plano_terapia_paciente_id_terapia_id_key|paciente_convenio_valido)/.exec(
        meta,
      )?.[1] ?? "?";

    return { codigo, constraint };
  }
}

/** O bloco de preenchimento da migration, lido do disco entre os marcadores. */
function preenchimentoDaMigration(): string {
  const sql = readFileSync(CAMINHO_DA_MIGRATION, "utf8");
  const bloco = /-- inicio: preenchimento do convenio\n([\s\S]*?)-- fim: preenchimento do convenio/.exec(
    sql,
  );

  if (!bloco) {
    throw new Error("marcadores do preenchimento nao encontrados na migration");
  }

  return bloco[1].trim().replace(/;$/, "");
}

describe.skipIf(!temBanco)("cadastro de paciente com plano de terapias", () => {
  beforeAll(async () => {
    await getPrismaClient().$connect();
  });

  it("paciente novo nasce com o convênio e o plano em minutos", async () => {
    const nome = `Plano Novo ${SUFIXO}`;

    const r = await comRollback(async (tx) => {
      const [a, b] = await terapiasDeTeste(tx, "nv");
      const resultado = await cadastrarPacienteNaTransacao(tx, {
        nome: `  ${nome}  `,
        convenio: "klini",
        terapias: [
          { terapiaId: a, horas: "2,5" },
          { terapiaId: b, horas: "0.25" },
        ],
      });

      return {
        resultado,
        a,
        b,
        pacientes: await pacientesComONome(tx, nome),
        plano: resultado.ok ? await planoCru(tx, resultado.pacienteId) : [],
      };
    });

    expect(r.resultado).toMatchObject({
      ok: true,
      pacienteNome: nome,
      pacienteCriado: true,
      convenioAdotado: false,
      linhasSubstituidas: 0,
      terapias: 2,
    });
    expect(r.pacientes).toEqual([
      { id: expect.any(Number), nome, convenio: "klini" },
    ]);
    expect(r.plano).toEqual([
      { terapiaId: r.a, minutos: 150 },
      { terapiaId: r.b, minutos: 15 },
    ]);
  });

  it("reenviar substitui o plano inteiro sem duplicar o paciente; caixa e espaço diferentes casam", async () => {
    const nome = `Plano Reenvio ${SUFIXO}`;

    const r = await comRollback(async (tx) => {
      const [a, b, c] = await terapiasDeTeste(tx, "re");
      const primeiro = await cadastrarPacienteNaTransacao(tx, {
        nome,
        convenio: "sulamerica",
        terapias: [
          { terapiaId: a, horas: "2" },
          { terapiaId: b, horas: "1" },
        ],
      });
      const segundo = await cadastrarPacienteNaTransacao(tx, {
        nome: `   ${nome.toUpperCase()} `,
        convenio: "sulamerica",
        terapias: [
          { terapiaId: b, horas: "3" },
          { terapiaId: c, horas: "0,5" },
        ],
      });

      return {
        primeiro,
        segundo,
        b,
        c,
        pacientes: await pacientesComONome(tx, nome),
        plano: primeiro.ok ? await planoCru(tx, primeiro.pacienteId) : [],
      };
    });

    expect(r.primeiro.ok && r.segundo.ok).toBe(true);
    if (!r.primeiro.ok || !r.segundo.ok) return;

    expect(r.segundo.pacienteId).toBe(r.primeiro.pacienteId);
    expect(r.segundo).toMatchObject({
      pacienteNome: nome, // o nome gravado, não o digitado
      pacienteCriado: false,
      convenioAdotado: false,
      linhasSubstituidas: 2,
      terapias: 2,
    });
    expect(r.pacientes).toEqual([
      { id: r.primeiro.pacienteId, nome, convenio: "sulamerica" },
    ]);
    // A terapia A, que não veio no reenvio, saiu; B mudou; C entrou.
    expect(r.plano).toEqual([
      { terapiaId: r.b, minutos: 180 },
      { terapiaId: r.c, minutos: 30 },
    ]);
  });

  it("paciente com convênio NULL adota o convênio do cadastro", async () => {
    const nome = `Plano Adota ${SUFIXO}`;

    const r = await comRollback(async (tx) => {
      const [a] = await terapiasDeTeste(tx, "ad");
      const id = await inserirPacienteCru(tx, nome, null);
      const resultado = await cadastrarPacienteNaTransacao(tx, {
        nome: nome.toLowerCase(),
        convenio: "sulamerica",
        terapias: [{ terapiaId: a, horas: "1" }],
      });

      return { id, resultado, pacientes: await pacientesComONome(tx, nome) };
    });

    expect(r.resultado).toMatchObject({
      ok: true,
      pacienteId: r.id,
      pacienteCriado: false,
      convenioAdotado: true,
      linhasSubstituidas: 0,
    });
    expect(r.pacientes).toEqual([{ id: r.id, nome, convenio: "sulamerica" }]);
  });

  it("paciente de outro convênio é recusado e nada muda", async () => {
    const nome = `Plano Outro ${SUFIXO}`;

    const r = await comRollback(async (tx) => {
      const [a, b] = await terapiasDeTeste(tx, "ou");
      const primeiro = await cadastrarPacienteNaTransacao(tx, {
        nome,
        convenio: "klini",
        terapias: [{ terapiaId: a, horas: "2" }],
      });
      const recusa = await cadastrarPacienteNaTransacao(tx, {
        nome,
        convenio: "sulamerica",
        terapias: [{ terapiaId: b, horas: "4" }],
      });

      return {
        a,
        recusa,
        pacientes: await pacientesComONome(tx, nome),
        plano: primeiro.ok ? await planoCru(tx, primeiro.pacienteId) : [],
      };
    });

    expect(r.recusa).toEqual({ ok: false, erro: ERRO_OUTRO_CONVENIO });
    expect(r.pacientes).toEqual([{ id: expect.any(Number), nome, convenio: "klini" }]);
    expect(r.plano).toEqual([{ terapiaId: r.a, minutos: 120 }]);
  });

  it("terapia repetida e plano vazio são recusados sem criar paciente", async () => {
    const nome = `Plano Recusa ${SUFIXO}`;

    const r = await comRollback(async (tx) => {
      const [a] = await terapiasDeTeste(tx, "rc");
      const repetida = await cadastrarPacienteNaTransacao(tx, {
        nome,
        convenio: "klini",
        terapias: [
          { terapiaId: a, horas: "1" },
          { terapiaId: a, horas: "2" },
        ],
      });
      const vazia = await cadastrarPacienteNaTransacao(tx, {
        nome,
        convenio: "klini",
        terapias: [],
      });

      return { repetida, vazia, pacientes: await pacientesComONome(tx, nome) };
    });

    expect(r.repetida).toEqual({ ok: false, erro: ERRO_TERAPIA_REPETIDA, linha: 1 });
    expect(r.vazia).toEqual({ ok: false, erro: ERRO_SEM_TERAPIA });
    expect(r.pacientes).toEqual([]);
  });

  it("terapia inexistente é recusada apontando a linha", async () => {
    const r = await comRollback(async (tx) => {
      const [a] = await terapiasDeTeste(tx, "ix");

      return cadastrarPacienteNaTransacao(tx, {
        nome: `Plano Inexistente ${SUFIXO}`,
        convenio: "klini",
        terapias: [
          { terapiaId: a, horas: "1" },
          { terapiaId: TERAPIA_INEXISTENTE, horas: "1" },
        ],
      });
    });

    expect(r).toEqual({ ok: false, erro: ERRO_TERAPIA_INEXISTENTE, linha: 1 });
  });

  it("o banco recusa minutos fora do CHECK e a terapia repetida, sem passar pelo domínio", async () => {
    const r = await comRollback(async (tx) => {
      const [a, b] = await terapiasDeTeste(tx, "ck");
      const id = await inserirPacienteCru(tx, `Plano Check ${SUFIXO}`, "klini");
      const inserir = (terapiaId: number, minutos: number) => (t: ClienteDaTransacao) =>
        t.$executeRaw`
          INSERT INTO "plano_terapia" ("paciente_id", "terapia_id", "minutos_semanais")
          VALUES (${id}, ${terapiaId}, ${minutos})
        `;

      return {
        zero: await tentarNoBanco(tx, inserir(a, 0)),
        dez: await tentarNoBanco(tx, inserir(a, 10)),
        negativo: await tentarNoBanco(tx, inserir(a, -15)),
        acimaForaDoPasso: await tentarNoBanco(tx, inserir(a, 10081)),
        acimaNoPasso: await tentarNoBanco(tx, inserir(a, 10095)),
        // Os limites que passam, para o teste não estar só recusando tudo.
        quinze: await tentarNoBanco(tx, inserir(a, 15)),
        maximo: await tentarNoBanco(tx, inserir(b, 10080)),
        repetida: await tentarNoBanco(tx, inserir(a, 30)),
        convenioInvalido: await tentarNoBanco(
          tx,
          (t) => t.$executeRaw`UPDATE "paciente" SET "convenio" = 'Klini' WHERE "id" = ${id}`,
        ),
      };
    });

    const check = { codigo: "23514", constraint: "plano_terapia_minutos_semanais_validos" };

    expect(r.zero).toEqual(check);
    expect(r.dez).toEqual(check);
    expect(r.negativo).toEqual(check);
    expect(r.acimaForaDoPasso).toEqual(check);
    expect(r.acimaNoPasso).toEqual(check);
    expect(r.quinze).toBeNull();
    expect(r.maximo).toBeNull();
    expect(r.repetida).toEqual({
      codigo: "23505",
      constraint: "plano_terapia_paciente_id_terapia_id_key",
    });
    expect(r.convenioInvalido).toEqual({ codigo: "23514", constraint: "paciente_convenio_valido" });
  });

  it("a exclusão permanente do paciente apaga o plano junto (cascade)", async () => {
    const nome = `Plano Exclusao ${SUFIXO}`;

    const r = await comRollback(async (tx) => {
      const [a, b] = await terapiasDeTeste(tx, "ex");
      const cadastro = await cadastrarPacienteNaTransacao(tx, {
        nome,
        convenio: "klini",
        terapias: [
          { terapiaId: a, horas: "1" },
          { terapiaId: b, horas: "2" },
        ],
      });

      if (!cadastro.ok) throw new Error("cadastro deveria passar");

      const antes = (await planoCru(tx, cadastro.pacienteId)).length;
      const exclusao = await excluirPacienteNaTransacao(tx, cadastro.pacienteId);

      return {
        antes,
        exclusao,
        depois: (await planoCru(tx, cadastro.pacienteId)).length,
        pacientes: await pacientesComONome(tx, nome),
        terapiasIntactas: await tx.terapia.count({ where: { id: { in: [a, b] } } }),
      };
    });

    expect(r.antes).toBe(2);
    expect(r.exclusao).toMatchObject({ ok: true, pacienteNome: nome });
    expect(r.depois).toBe(0);
    expect(r.pacientes).toEqual([]);
    expect(r.terapiasIntactas).toBe(2);
  });

  it("as leituras trazem o plano em ordem e quem não tem plano", async () => {
    const r = await comRollback(async (tx) => {
      const [a, b] = await terapiasDeTeste(tx, "le");
      const comPlano = await cadastrarPacienteNaTransacao(tx, {
        nome: `Plano Leitura Com ${SUFIXO}`,
        convenio: "sulamerica",
        terapias: [
          { terapiaId: b, horas: "1,25" },
          { terapiaId: a, horas: "3" },
        ],
      });
      const semPlano = await inserirPacienteCru(tx, `Plano Leitura Sem ${SUFIXO}`, "sulamerica");
      const daKlini = await inserirPacienteCru(tx, `Plano Leitura Klini ${SUFIXO}`, "klini");
      const semConvenio = await inserirPacienteCru(tx, `Plano Leitura Nulo ${SUFIXO}`, null);

      if (!comPlano.ok) throw new Error("cadastro deveria passar");

      const lista = await listarPacientesDoConvenioComCliente(tx, "sulamerica");

      return {
        a,
        b,
        comPlanoId: comPlano.pacienteId,
        semPlano,
        idsFora: [daKlini, semConvenio],
        lista: lista.filter((p) => p.pacienteNome.endsWith(SUFIXO)),
        idsNaLista: lista.map((p) => p.pacienteId),
        plano: await planoDoPacienteComCliente(tx, comPlano.pacienteId),
        planoVazio: await planoDoPacienteComCliente(tx, semPlano),
        idInvalido: await planoDoPacienteComCliente(tx, 0),
      };
    });

    const terapiaA = { terapiaId: r.a, terapiaNome: `Plano A le ${SUFIXO}`, minutosSemanais: 180 };
    const terapiaB = { terapiaId: r.b, terapiaNome: `Plano B le ${SUFIXO}`, minutosSemanais: 75 };

    expect(r.lista).toEqual([
      {
        pacienteId: r.comPlanoId,
        pacienteNome: `Plano Leitura Com ${SUFIXO}`,
        plano: [terapiaA, terapiaB],
        temPlano: true,
      },
      {
        pacienteId: r.semPlano,
        pacienteNome: `Plano Leitura Sem ${SUFIXO}`,
        plano: [],
        temPlano: false,
      },
    ]);
    expect(r.idsNaLista).not.toContain(r.idsFora[0]);
    expect(r.idsNaLista).not.toContain(r.idsFora[1]);
    expect(r.plano).toEqual([terapiaA, terapiaB]);
    expect(r.planoVazio).toEqual([]);
    expect(r.idInvalido).toEqual([]);
  });

  it("o preenchimento da migration dá klini, sulamerica, NULL e NULL (e não sobrescreve)", async () => {
    const sql = preenchimentoDaMigration();

    const r = await comRollback(async (tx) => {
      // Tabelas temporárias com os mesmos nomes: o `pg_temp` vem antes de
      // `public` na busca, então o UPDATE do arquivo — sem mudar uma letra —
      // roda contra elas, e não contra os pacientes reais.
      await tx.$executeRawUnsafe(
        `CREATE TEMP TABLE "paciente" ("id" INTEGER PRIMARY KEY, "convenio" TEXT) ON COMMIT DROP`,
      );
      await tx.$executeRawUnsafe(
        `CREATE TEMP TABLE "encaminhamento" ("paciente_id" INTEGER) ON COMMIT DROP`,
      );
      await tx.$executeRawUnsafe(
        `CREATE TEMP TABLE "autorizacao_sulamerica" ("paciente_id" INTEGER) ON COMMIT DROP`,
      );
      // 1 só encaminhamento, 2 só autorização, 3 nenhum, 4 os dois, 5 já tem
      // convênio gravado (não pode ser sobrescrito).
      await tx.$executeRawUnsafe(
        `INSERT INTO "paciente" VALUES (1, NULL), (2, NULL), (3, NULL), (4, NULL), (5, 'sulamerica')`,
      );
      await tx.$executeRawUnsafe(`INSERT INTO "encaminhamento" VALUES (1), (4), (5)`);
      await tx.$executeRawUnsafe(`INSERT INTO "autorizacao_sulamerica" VALUES (2), (4)`);

      const atualizadas = await tx.$executeRawUnsafe(sql);
      const linhas = await tx.$queryRawUnsafe<{ id: number; convenio: string | null }[]>(
        `SELECT "id", "convenio" FROM "paciente" ORDER BY "id"`,
      );

      return { atualizadas, linhas };
    });

    expect(sql).toMatch(/^UPDATE "paciente"/);
    expect(r.atualizadas).toBe(2);
    expect(r.linhas).toEqual([
      { id: 1, convenio: "klini" },
      { id: 2, convenio: "sulamerica" },
      { id: 3, convenio: null },
      { id: 4, convenio: null },
      { id: 5, convenio: "sulamerica" },
    ]);
  });
});

describe.skipIf(!temBanco)("cadastro de paciente — atomicidade com commit de verdade", () => {
  const nomesCriados: string[] = [];
  let terapiaId = 0;

  beforeAll(async () => {
    const terapia = await getPrismaClient().terapia.create({
      data: { nome: `Plano Atomicidade ${SUFIXO}`, codigoTiss: `PLAT${SUFIXO}`.slice(0, 10) },
      select: { id: true },
    });
    terapiaId = terapia.id;
  });

  afterAll(async () => {
    const prisma = getPrismaClient();

    // Só sobra algo aqui se o teste falhar: aí o paciente commitou indevidamente.
    for (const nome of nomesCriados) {
      try {
        await prisma.$executeRaw`DELETE FROM "paciente" WHERE lower("nome") = lower(${nome})`;
      } catch (erro) {
        console.error("limpeza: paciente de teste nao apagado", erro);
      }
    }

    try {
      await prisma.terapia.delete({ where: { id: terapiaId } });
    } catch (erro) {
      console.error("limpeza: terapia de teste nao apagada", terapiaId, erro);
    }
  });

  it("recusa de terapia inexistente pela função de produção desfaz o paciente recém-criado", async () => {
    const nome = `Plano Atomico Negocio ${SUFIXO}`;
    nomesCriados.push(nome);

    const resultado = await cadastrarPaciente({
      nome,
      convenio: "klini",
      terapias: [
        { terapiaId, horas: "1" },
        { terapiaId: TERAPIA_INEXISTENTE, horas: "1" },
      ],
    });

    expect(resultado).toEqual({ ok: false, erro: ERRO_TERAPIA_INEXISTENTE, linha: 1 });
    expect(await pacientesComONome(getPrismaClient(), nome)).toEqual([]);
  });

  it("falha inesperada no INSERT do plano desfaz o paciente e o convênio", async () => {
    const nome = `Plano Atomico Falha ${SUFIXO}`;
    nomesCriados.push(nome);

    const entrada: EntradaCadastroDePaciente = {
      nome,
      convenio: "sulamerica",
      terapias: [{ terapiaId, horas: "2" }],
    };

    let pacienteVistoAntesDaFalha = false;

    await expect(
      getPrismaClient().$transaction(async (tx) => {
        // O `Proxy` faz o INSERT do plano estourar **depois** de o paciente ter
        // sido criado e ganhado o convênio na mesma transação.
        const txQueFalha = new Proxy(tx, {
          get(alvo, propriedade) {
            const valor = Reflect.get(alvo, propriedade) as unknown;

            if (propriedade === "planoTerapia") {
              return {
                createMany: async () => {
                  pacienteVistoAntesDaFalha =
                    (await pacientesComONome(tx, nome)).some((p) => p.convenio === "sulamerica");
                  throw new ErroInjetado();
                },
              };
            }

            return typeof valor === "function" ? valor.bind(alvo) : valor;
          },
        }) as ClienteDaTransacao;

        return cadastrarPacienteNaTransacao(txQueFalha, entrada);
      }, OPCOES),
    ).rejects.toBeInstanceOf(ErroInjetado);

    expect(pacienteVistoAntesDaFalha).toBe(true);
    expect(await pacientesComONome(getPrismaClient(), nome)).toEqual([]);
  });
});

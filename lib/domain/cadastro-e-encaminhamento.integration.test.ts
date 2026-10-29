/**
 * Os fluxos entre as abas, contra o Postgres real (regra 24): a aba Cadastro
 * é a única porta de entrada do paciente, e as abas Encaminhamentos só acham
 * paciente que já existe **naquele** convênio.
 *
 * As regras do cadastro em si (substituição, adoção do convênio, recusas,
 * CHECK) estão em `plano-terapias.integration.test.ts`; as do encaminhamento,
 * em `encaminhamentos.integration.test.ts` e
 * `autorizacoes-sulamerica.integration.test.ts`. Aqui fica o que atravessa as
 * duas telas — e o que a tela Cadastro lê, que não pode trazer carteirinha
 * nem CRM.
 *
 * Mesmo contrato dos outros testes de integração: sem DATABASE_URL o bloco é
 * pulado, e tudo roda numa transação com rollback — menos o último bloco, que
 * passa pela transação de produção e limpa o que sobrar.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getPrismaClient } from "@/lib/db";

import { registrarAutorizacaoNaTransacao } from "./autorizacoes-sulamerica";
import {
  registrarEncaminhamento,
  registrarEncaminhamentoNaTransacao,
} from "./encaminhamentos";
import { listarPacientesParaEncaminhamentoComCliente } from "./pacientes";
import {
  ERRO_PACIENTE_DE_OUTRO_CONVENIO,
  ERRO_PACIENTE_FORA_DO_CADASTRO,
} from "./pacientes-mensagens";
import {
  cadastrarPacienteNaTransacao,
  listarPacientesDoConvenioComCliente,
} from "./plano-terapias";

const temBanco = Boolean(process.env.DATABASE_URL);

const SUFIXO = Math.random().toString(36).slice(2, 10);

const carteirinha = () => `C${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;

class Rollback<T> extends Error {
  constructor(readonly dados: T) {
    super("rollback proposital do teste de integracao");
  }
}

type ClienteDaTransacao = Parameters<
  Parameters<ReturnType<typeof getPrismaClient>["$transaction"]>[0]
>[0];

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

/** Duas terapias novas, só deste teste. */
async function duasTerapias(tx: ClienteDaTransacao, rotulo: string) {
  const [a, b] = await Promise.all(
    ["A", "B"].map((letra) =>
      tx.terapia.create({
        data: { nome: `Fluxo ${letra} ${rotulo} ${SUFIXO}`, codigoTiss: `F${letra}` },
        select: { id: true },
      }),
    ),
  );

  return [a.id, b.id] as const;
}

async function contarPacientes(
  cliente: Pick<ClienteDaTransacao, "$queryRaw">,
  nome: string,
): Promise<number> {
  const [linha] = await cliente.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS "n" FROM "paciente" WHERE lower("nome") = lower(${nome})
  `;
  return linha.n;
}

describe.skipIf(!temBanco)("Cadastro → Encaminhamento contra o banco real", () => {
  beforeAll(async () => {
    await getPrismaClient().$connect();
  });

  afterAll(async () => {
    await getPrismaClient().$disconnect();
  });

  it("Klini: o cadastro cria paciente e plano, aparece só na aba da Klini, e o encaminhamento o acha", async () => {
    const nome = `Fluxo Klini ${SUFIXO}`;

    const r = await comRollback(async (tx) => {
      const [a, b] = await duasTerapias(tx, "kl");
      const cadastro = await cadastrarPacienteNaTransacao(tx, {
        nome,
        convenio: "klini",
        terapias: [
          { terapiaId: a, horas: "2" },
          { terapiaId: b, horas: "1,5" },
        ],
      });

      const klini = await listarPacientesDoConvenioComCliente(tx, "klini");
      const sulamerica = await listarPacientesDoConvenioComCliente(tx, "sulamerica");
      const datalistKlini = await listarPacientesParaEncaminhamentoComCliente(tx, "klini");

      const encaminhamento = await registrarEncaminhamentoNaTransacao(tx, {
        pacienteNome: nome.toUpperCase(),
        dataEncaminhamento: "2026-10-01",
        numeroCarteirinha: carteirinha(),
        crmMedico: "123456",
      });
      // O mesmo paciente na aba da SulAmérica: recusado, nada gravado.
      const naSulamerica = await registrarAutorizacaoNaTransacao(tx, {
        pacienteNome: nome,
        dataInicio: "2026-10-01",
        prazoMeses: 3,
        numeroCarteirinha: "",
        crmMedico: "999",
        nomeMedico: "Dra. Teste",
      });
      const [gravado] = await tx.$queryRaw<{ crm: string | null; autorizacoes: number }[]>`
        SELECT p."crm_medico" AS "crm",
          (SELECT count(*)::int FROM "autorizacao_sulamerica" s WHERE s."paciente_id" = p."id") AS "autorizacoes"
        FROM "paciente" p WHERE lower(p."nome") = lower(${nome})
      `;

      return {
        a, b, cadastro, encaminhamento, naSulamerica, gravado,
        naKlini: klini.find((p) => p.pacienteNome === nome),
        naSulamericaLista: sulamerica.some((p) => p.pacienteNome === nome),
        noDatalist: datalistKlini.some((p) => p.nome === nome),
        pacientes: await contarPacientes(tx, nome),
      };
    });

    expect(r.cadastro).toMatchObject({ ok: true, pacienteCriado: true });
    // A linha da tela Cadastro tem só nome e plano — nenhuma carteirinha ou
    // CRM, nem depois de o encaminhamento gravá-los.
    expect(r.naKlini && Object.keys(r.naKlini).sort()).toEqual([
      "pacienteId", "pacienteNome", "plano", "temPlano",
    ]);
    expect(r.naKlini?.plano.map((t) => t.minutosSemanais)).toEqual([120, 90]);
    expect(r.naSulamericaLista).toBe(false);
    expect(r.noDatalist).toBe(true);
    expect(r.encaminhamento).toMatchObject({ ok: true, pacienteNome: nome });
    expect(r.naSulamerica).toEqual({ ok: false, erro: ERRO_PACIENTE_DE_OUTRO_CONVENIO });
    expect(r.gravado).toEqual({ crm: "123456", autorizacoes: 0 });
    expect(r.pacientes).toBe(1);
  });

  it("SulAmérica: Cadastro → Encaminhamento, e a Klini recusa o mesmo paciente", async () => {
    const nome = `Fluxo SulAmerica ${SUFIXO}`;

    const r = await comRollback(async (tx) => {
      const [a] = await duasTerapias(tx, "sa");
      const antes = await registrarAutorizacaoNaTransacao(tx, {
        pacienteNome: nome, dataInicio: "2026-10-01", prazoMeses: 6,
        numeroCarteirinha: carteirinha(), crmMedico: "123", nomeMedico: "Dra. Teste",
      });
      const cadastro = await cadastrarPacienteNaTransacao(tx, {
        nome, convenio: "sulamerica", terapias: [{ terapiaId: a, horas: "1" }],
      });
      const autorizacao = await registrarAutorizacaoNaTransacao(tx, {
        pacienteNome: nome, dataInicio: "2026-10-01", prazoMeses: 6,
        numeroCarteirinha: carteirinha(), crmMedico: "123", nomeMedico: "Dra. Teste",
      });
      const naKlini = await registrarEncaminhamentoNaTransacao(tx, {
        pacienteNome: nome, dataEncaminhamento: "2026-10-01",
        numeroCarteirinha: "", crmMedico: "456",
      });

      return {
        antes, cadastro, autorizacao, naKlini,
        listaSulamerica: (await listarPacientesDoConvenioComCliente(tx, "sulamerica"))
          .some((p) => p.pacienteNome === nome),
        listaKlini: (await listarPacientesDoConvenioComCliente(tx, "klini"))
          .some((p) => p.pacienteNome === nome),
        encaminhamentosKlini: (await tx.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS "n" FROM "encaminhamento" e
          JOIN "paciente" p ON p."id" = e."paciente_id" WHERE lower(p."nome") = lower(${nome})
        `)[0].n,
      };
    });

    expect(r.antes).toEqual({ ok: false, erro: ERRO_PACIENTE_FORA_DO_CADASTRO });
    expect(r.cadastro).toMatchObject({ ok: true, pacienteCriado: true });
    expect(r.autorizacao).toMatchObject({ ok: true, substituiuAnterior: false, dataVencimento: "2027-04-01" });
    expect(r.naKlini).toEqual({ ok: false, erro: ERRO_PACIENTE_DE_OUTRO_CONVENIO });
    expect(r.listaSulamerica).toBe(true);
    expect(r.listaKlini).toBe(false);
    expect(r.encaminhamentosKlini).toBe(0);
  });

  it("editar no Cadastro substitui o plano, e o paciente sem convênio adota o da aba e passa a receber encaminhamento", async () => {
    const nome = `Fluxo Legado ${SUFIXO}`;

    const r = await comRollback(async (tx) => {
      const [a, b] = await duasTerapias(tx, "lg");
      // Paciente antigo, sem convênio (a migration deixou NULL).
      await tx.$executeRaw`INSERT INTO "paciente" ("nome") VALUES (${nome})`;
      const recusado = await registrarEncaminhamentoNaTransacao(tx, {
        pacienteNome: nome, dataEncaminhamento: "2026-10-01",
        numeroCarteirinha: carteirinha(), crmMedico: "1",
      });

      const adotou = await cadastrarPacienteNaTransacao(tx, {
        nome, convenio: "klini",
        terapias: [{ terapiaId: a, horas: "2" }, { terapiaId: b, horas: "1" }],
      });
      // O "Editar" da tela: mesmo nome, plano novo — o envio substitui tudo.
      const editado = await cadastrarPacienteNaTransacao(tx, {
        nome, convenio: "klini", terapias: [{ terapiaId: b, horas: "0,75" }],
      });
      const aceito = await registrarEncaminhamentoNaTransacao(tx, {
        pacienteNome: nome, dataEncaminhamento: "2026-10-01",
        numeroCarteirinha: carteirinha(), crmMedico: "1",
      });

      return {
        b, recusado, adotou, editado, aceito,
        naLista: (await listarPacientesDoConvenioComCliente(tx, "klini"))
          .find((p) => p.pacienteNome === nome),
        pacientes: await contarPacientes(tx, nome),
      };
    });

    expect(r.recusado).toMatchObject({ ok: false });
    expect(r.adotou).toMatchObject({ ok: true, pacienteCriado: false, convenioAdotado: true });
    expect(r.editado).toMatchObject({ ok: true, pacienteCriado: false, linhasSubstituidas: 2, terapias: 1 });
    expect(r.naLista?.plano).toEqual([
      { terapiaId: r.b, terapiaNome: `Fluxo B lg ${SUFIXO}`, minutosSemanais: 45 },
    ]);
    expect(r.aceito).toMatchObject({ ok: true });
    expect(r.pacientes).toBe(1);
  });
});

describe.skipIf(!temBanco)("encaminhamento de nome inexistente — transação de produção", () => {
  afterAll(async () => {
    await getPrismaClient().$disconnect();
  });

  it("registrarEncaminhamento não cria paciente nem encaminhamento", async () => {
    const nome = `Fluxo Producao Inexistente ${SUFIXO}`;

    try {
      expect(
        await registrarEncaminhamento({
          pacienteNome: nome,
          dataEncaminhamento: "2026-10-01",
          numeroCarteirinha: carteirinha(),
          crmMedico: "123456",
        }),
      ).toEqual({ ok: false, erro: ERRO_PACIENTE_FORA_DO_CADASTRO });
      expect(await contarPacientes(getPrismaClient(), nome)).toBe(0);
    } finally {
      // Só recolhe se o código estiver errado e tiver criado.
      await getPrismaClient().$executeRaw`
        DELETE FROM "encaminhamento" WHERE "paciente_id" IN
          (SELECT "id" FROM "paciente" WHERE lower("nome") = lower(${nome}))
      `;
      await getPrismaClient().$executeRaw`
        DELETE FROM "paciente" WHERE lower("nome") = lower(${nome})
      `;
    }
  });
});

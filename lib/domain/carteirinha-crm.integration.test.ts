/**
 * Carteirinha e CRM do paciente contra o Postgres real.
 *
 * Duas camadas sob teste, separadas de propósito:
 *
 *   - **o domínio** (`registrarEncaminhamentoNaTransacao`): grava os dois no
 *     paciente, atualiza no reenvio, recusa carteirinha de outro paciente com o
 *     nome dele — pela checagem prévia e também pelo índice único, quando a
 *     checagem não enxerga o conflito (a corrida);
 *   - **o banco** (migration `20261028120000_carteirinha_e_crm_do_paciente`):
 *     os CHECK e o índice recusam por conta própria, sem o domínio no caminho.
 *     É a garantia de quem um dia gravar por fora dele.
 *
 * Mesmo contrato dos outros testes de integração: precisa de DATABASE_URL com
 * as migrations aplicadas (sem ela, o bloco é pulado) e tudo roda numa
 * transação que sempre sofre rollback. Todos os valores são sintéticos — nada
 * aqui é dado de paciente real.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getPrismaClient } from "@/lib/db";

import {
  ERRO_CARTEIRINHA_INVALIDA,
  ERRO_CARTEIRINHA_OBRIGATORIA_SEM_CADASTRO,
  ERRO_CRM_INVALIDO,
  erroCarteirinhaDeOutroPaciente,
} from "./carteirinha-crm";
import { cadastrarPacienteDeTeste } from "@/test/paciente-cadastrado";

import {
  listarEncaminhamentosNaTransacao,
  registrarEncaminhamentoNaTransacao,
  type EntradaNovoEncaminhamento,
} from "./encaminhamentos";
import { ERRO_PACIENTE_FORA_DO_CADASTRO } from "./pacientes-mensagens";

const temBanco = Boolean(process.env.DATABASE_URL);

/** Sufixo único para não colidir com paciente já existente. */
const SUFIXO = Math.random().toString(36).slice(2, 10);

/** Carteirinha sintética, única por chamada e só com letras/dígitos. */
function carteirinhaDeTeste(): string {
  return `T${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

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

/** Uma entrada completa e válida para o paciente `nome`. */
function entrada(
  nome: string,
  campos: Partial<EntradaNovoEncaminhamento> = {},
): EntradaNovoEncaminhamento {
  return {
    pacienteNome: nome,
    dataEncaminhamento: "2026-10-01",
    numeroCarteirinha: carteirinhaDeTeste(),
    crmMedico: "123456",
    ...campos,
  };
}

type PacienteGravado = {
  id: number;
  nome: string;
  numeroCarteirinha: string | null;
  crmMedico: string | null;
};

/** Os pacientes com este nome, comparando como o índice de nome compara. */
async function pacientesComNome(
  tx: ClienteDaTransacao,
  nome: string,
): Promise<PacienteGravado[]> {
  return tx.$queryRaw<PacienteGravado[]>`
    SELECT
      "id",
      "nome",
      "numero_carteirinha" AS "numeroCarteirinha",
      "crm_medico"         AS "crmMedico"
    FROM "paciente"
    WHERE lower("nome") = lower(${nome})
  `;
}

/** Quantos encaminhamentos o paciente de nome `nome` tem. */
async function contarEncaminhamentos(
  tx: ClienteDaTransacao,
  nome: string,
): Promise<number> {
  const [linha] = await tx.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS "n"
    FROM "encaminhamento" e
    JOIN "paciente" p ON p."id" = e."paciente_id"
    WHERE lower(p."nome") = lower(${nome})
  `;

  return linha.n;
}

/**
 * Roda um comando cru num `SAVEPOINT` e devolve o código SQLSTATE e o nome da
 * constraint da recusa (ou `null` se o banco aceitou).
 *
 * O savepoint é o que deixa o teste fazer várias tentativas recusadas na
 * mesma transação: sem ele, a primeira recusa aborta a transação inteira.
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
      /(paciente_numero_carteirinha_formato|paciente_crm_medico_formato|paciente_numero_carteirinha_lower_key)/.exec(
        meta,
      )?.[1] ?? "?";

    return { codigo, constraint };
  }
}

/**
 * Insere um paciente cru, sem o domínio — como um paciente de antes da
 * carteirinha. Com convênio `klini`, que é o que a migration de 29/10/2026 deu
 * a quem já tinha encaminhamento: sem convênio o encaminhamento o recusaria
 * (regra 24) antes de chegar à carteirinha.
 */
async function inserirPacienteCru(
  tx: ClienteDaTransacao,
  nome: string,
): Promise<number> {
  const [paciente] = await tx.$queryRaw<{ id: number }[]>`
    INSERT INTO "paciente" ("nome", "convenio") VALUES (${nome}, 'klini') RETURNING "id"
  `;

  return paciente.id;
}

/**
 * O paciente cadastrado na aba Cadastro da Klini — desde a regra 24 o
 * encaminhamento só aceita paciente que já existe.
 */
async function cadastrado(tx: ClienteDaTransacao, ...nomes: string[]) {
  for (const nome of nomes) {
    await cadastrarPacienteDeTeste(tx, nome, "klini");
  }
}

describe.skipIf(!temBanco)("carteirinha e CRM contra o banco real", () => {
  beforeAll(async () => {
    // Abre a conexão fora do relógio da primeira transação.
    await getPrismaClient().$connect();
  });

  afterAll(async () => {
    await getPrismaClient().$disconnect();
  });

  it("paciente cadastrado recebe carteirinha e CRM normalizados", async () => {
    const nome = `Carteirinha Novo ${SUFIXO}`;

    const resultado = await comRollback(async (tx) => {
      await cadastrado(tx, nome);
      const gravacao = await registrarEncaminhamentoNaTransacao(
        tx,
        entrada(nome, {
          numeroCarteirinha: "  Ab12 3456 7890  ",
          crmMedico: " 123.456 ",
        }),
      );

      const lista = await listarEncaminhamentosNaTransacao(tx);

      return {
        gravacao,
        pacientes: await pacientesComNome(tx, nome),
        naLista: lista.filter((linha) => linha.pacienteNome === nome),
      };
    });

    expect(resultado.gravacao).toMatchObject({ ok: true });
    expect(resultado.pacientes).toHaveLength(1);
    // Espaços fora, caixa preservada; pontos fora do CRM.
    expect(resultado.pacientes[0]).toMatchObject({
      numeroCarteirinha: "Ab1234567890",
      crmMedico: "123456",
    });
    expect(resultado.naLista).toHaveLength(1);
    expect(resultado.naLista[0]).toMatchObject({
      numeroCarteirinha: "Ab1234567890",
      crmMedico: "123456",
    });
  });

  it("reenviar o mesmo paciente com CRM diferente atualiza, sem duplicar", async () => {
    const nome = `Carteirinha Reenvio ${SUFIXO}`;
    const carteirinha = carteirinhaDeTeste();

    const resultado = await comRollback(async (tx) => {
      await cadastrado(tx, nome);
      const primeiro = await registrarEncaminhamentoNaTransacao(
        tx,
        entrada(nome, { numeroCarteirinha: carteirinha, crmMedico: "111111" }),
      );

      // Mesma carteirinha em outra caixa: é do próprio paciente, não conflito.
      const segundo = await registrarEncaminhamentoNaTransacao(
        tx,
        entrada(nome.toUpperCase(), {
          numeroCarteirinha: carteirinha.toLowerCase(),
          crmMedico: "2222222",
          dataEncaminhamento: "2026-10-20",
        }),
      );

      return {
        primeiro,
        segundo,
        pacientes: await pacientesComNome(tx, nome),
        encaminhamentos: await contarEncaminhamentos(tx, nome),
      };
    });

    expect(resultado.primeiro).toMatchObject({ ok: true });
    expect(resultado.segundo).toMatchObject({
      ok: true,
      substituiuAnterior: true,
    });
    expect(resultado.pacientes).toHaveLength(1);
    expect(resultado.pacientes[0]).toMatchObject({
      numeroCarteirinha: carteirinha.toLowerCase(),
      crmMedico: "2222222",
    });
    expect(resultado.encaminhamentos).toBe(1);
  });

  it("recusa carteirinha de outro paciente, citando o dono", async () => {
    const dono = `Carteirinha Dono ${SUFIXO}`;
    const outro = `Carteirinha Intruso ${SUFIXO}`;
    const carteirinha = carteirinhaDeTeste();

    const resultado = await comRollback(async (tx) => {
      await cadastrado(tx, dono, outro);
      await registrarEncaminhamentoNaTransacao(
        tx,
        entrada(dono, { numeroCarteirinha: carteirinha, crmMedico: "111111" }),
      );

      const recusa = await registrarEncaminhamentoNaTransacao(
        tx,
        entrada(outro, { numeroCarteirinha: carteirinha }),
      );

      return {
        recusa,
        doDono: await pacientesComNome(tx, dono),
        doOutro: await pacientesComNome(tx, outro),
        encaminhamentosDoOutro: await contarEncaminhamentos(tx, outro),
      };
    });

    expect(resultado.recusa).toEqual({
      ok: false,
      erro: erroCarteirinhaDeOutroPaciente(dono),
    });
    // O dono continua com o que tinha.
    expect(resultado.doDono[0]).toMatchObject({
      numeroCarteirinha: carteirinha,
      crmMedico: "111111",
    });
    // O outro (cadastrado, sem encaminhamento) não ganhou encaminhamento nem
    // carteirinha.
    expect(resultado.encaminhamentosDoOutro).toBe(0);
    expect(resultado.doOutro.every((p) => p.numeroCarteirinha === null)).toBe(
      true,
    );
  });

  it("recusa a mesma carteirinha em caixa diferente", async () => {
    const dono = `Carteirinha Caixa Dono ${SUFIXO}`;
    const outro = `Carteirinha Caixa Outro ${SUFIXO}`;

    const recusa = await comRollback(async (tx) => {
      await cadastrado(tx, dono, outro);
      await registrarEncaminhamentoNaTransacao(
        tx,
        entrada(dono, { numeroCarteirinha: `ABCdef${SUFIXO}` }),
      );

      return registrarEncaminhamentoNaTransacao(
        tx,
        entrada(outro, { numeroCarteirinha: `abcDEF${SUFIXO}`.toUpperCase() }),
      );
    });

    expect(recusa).toEqual({
      ok: false,
      erro: erroCarteirinhaDeOutroPaciente(dono),
    });
  });

  it("na corrida, o índice único recusa e a mensagem ainda cita o dono", async () => {
    // Simula a janela da corrida: dois cadastros simultâneos passam os dois
    // pela checagem prévia sem enxergar o outro. Aqui a checagem é cegada uma
    // vez (o `$queryRaw` dela devolve vazio), e quem tem de recusar é o índice
    // `paciente_numero_carteirinha_lower_key`. O `SAVEPOINT` do domínio é o
    // que permite, depois da recusa, consultar o nome do dono na mesma
    // transação — e é o que este teste prova, junto com a transação continuar
    // utilizável depois.
    const dono = `Carteirinha Corrida Dono ${SUFIXO}`;
    const outro = `Carteirinha Corrida Outro ${SUFIXO}`;
    const carteirinha = carteirinhaDeTeste();

    const resultado = await comRollback(async (tx) => {
      await cadastrado(tx, dono, outro);
      await registrarEncaminhamentoNaTransacao(
        tx,
        entrada(dono, { numeroCarteirinha: carteirinha }),
      );

      let checagensCegadas = 0;

      const cego = new Proxy(tx, {
        get(alvo, propriedade) {
          const valor = Reflect.get(alvo, propriedade) as unknown;

          if (propriedade !== "$queryRaw") {
            return typeof valor === "function" ? valor.bind(alvo) : valor;
          }

          return (...argumentos: unknown[]) => {
            const sql = (argumentos[0] as readonly string[]).join("?");

            // A checagem de dono (`donoDaCarteirinha`), e não a leitura de
            // `situacaoDaCarteirinha`, que também tem "IS NOT NULL" no SQL:
            // cegar aquela faria o teste passar pela checagem prévia, sem
            // chegar ao índice.
            if (
              checagensCegadas === 0 &&
              sql.includes('AND lower("numero_carteirinha") = lower(')
            ) {
              checagensCegadas += 1;
              return Promise.resolve([]);
            }

            return (valor as (...a: unknown[]) => unknown).apply(
              alvo,
              argumentos,
            );
          };
        },
      }) as ClienteDaTransacao;

      const recusa = await registrarEncaminhamentoNaTransacao(
        cego,
        entrada(outro, { numeroCarteirinha: carteirinha.toLowerCase() }),
      );

      return {
        checagensCegadas,
        recusa,
        // Se o savepoint não tivesse sido desfeito, esta consulta estouraria
        // com "current transaction is aborted".
        encaminhamentosDoOutro: await contarEncaminhamentos(tx, outro),
        doOutro: await pacientesComNome(tx, outro),
      };
    });

    expect(resultado.checagensCegadas).toBe(1);
    expect(resultado.recusa).toEqual({
      ok: false,
      erro: erroCarteirinhaDeOutroPaciente(dono),
    });
    expect(resultado.encaminhamentosDoOutro).toBe(0);
    expect(resultado.doOutro.every((p) => p.numeroCarteirinha === null)).toBe(
      true,
    );
  });

  it("erro inesperado do banco escapa sem carteirinha nem CRM", async () => {
    // A violação de CHECK traz no `meta` do Prisma o `detail` do Postgres —
    // "Failing row contains (...)", a linha inteira. O domínio valida antes e
    // esse erro não deveria acontecer; para provocá-lo, o `update` do
    // paciente é adulterado para gravar valores fora do formato. O que se
    // afirma é que o erro que escapa não carrega nenhum dos dois valores, nem
    // por `cause`.
    const nome = `Carteirinha Saneamento ${SUFIXO}`;
    const carteirinhaRuim = "ZZ 99887766";
    const crmRuim = "55443322X";

    let capturado: unknown = null;

    try {
      await comRollback(async (tx) => {
        const adulterado = new Proxy(tx, {
          get(alvo, propriedade) {
            const valor = Reflect.get(alvo, propriedade) as unknown;

            if (propriedade !== "paciente") {
              return typeof valor === "function" ? valor.bind(alvo) : valor;
            }

            const delegado = valor as ClienteDaTransacao["paciente"];

            return new Proxy(delegado, {
              get(alvoDoModelo, metodo) {
                const original = Reflect.get(alvoDoModelo, metodo) as unknown;

                if (metodo !== "update") {
                  return typeof original === "function"
                    ? original.bind(alvoDoModelo)
                    : original;
                }

                return (argumentos: { where: { id: number } }) =>
                  delegado.update({
                    where: argumentos.where,
                    data: {
                      numeroCarteirinha: carteirinhaRuim,
                      crmMedico: crmRuim,
                    },
                  });
              },
            });
          },
        }) as ClienteDaTransacao;

        await cadastrado(tx, nome);
        return registrarEncaminhamentoNaTransacao(adulterado, entrada(nome));
      });
    } catch (erro) {
      capturado = erro;
    }

    expect(capturado).toBeInstanceOf(Error);

    const erro = capturado as Error & { cause?: unknown; meta?: unknown };
    const tudo = [
      erro.message,
      String(erro.stack),
      JSON.stringify(erro),
      String(erro.cause ?? ""),
      JSON.stringify(erro.meta ?? null),
    ].join("\n");

    for (const valor of [carteirinhaRuim, "99887766", crmRuim, "55443322"]) {
      expect(tudo).not.toContain(valor);
    }
    expect(erro.cause).toBeUndefined();
    expect(erro.message).toMatch(/falha ao gravar carteirinha\/CRM do paciente/);
  });

  it("o banco recusa formato inválido mesmo sem passar pelo domínio", async () => {
    const recusas = await comRollback(async (tx) => {
      const id = await inserirPacienteCru(tx, `Carteirinha Cru ${SUFIXO}`);

      const tentar = (coluna: "carteirinha" | "crm", valor: string) =>
        tentarNoBanco(tx, (t) =>
          coluna === "carteirinha"
            ? t.$executeRaw`UPDATE "paciente" SET "numero_carteirinha" = ${valor} WHERE "id" = ${id}`
            : t.$executeRaw`UPDATE "paciente" SET "crm_medico" = ${valor} WHERE "id" = ${id}`,
        );

      return {
        crmComLetra: await tentar("crm", "12345A"),
        crmOnzeDigitos: await tentar("crm", "12345678901"),
        crmVazio: await tentar("crm", ""),
        carteirinhaComEspaco: await tentar("carteirinha", "ABC 12345"),
        carteirinhaQuatro: await tentar("carteirinha", "AB12"),
        carteirinhaVinteESeis: await tentar("carteirinha", "A".repeat(26)),
        carteirinhaAcentuada: await tentar("carteirinha", "ÇABC12345"),
        // Os limites que passam, para o teste não estar só recusando tudo.
        crmDezDigitos: await tentar("crm", "1234567890"),
        crmUmDigito: await tentar("crm", "7"),
        carteirinhaCinco: await tentar("carteirinha", "AB123"),
        carteirinhaVinteECinco: await tentar("carteirinha", "B".repeat(25)),
        // NULL é o legado, e continua aceito.
        carteirinhaNula: await tentarNoBanco(
          tx,
          (t) =>
            t.$executeRaw`UPDATE "paciente" SET "numero_carteirinha" = NULL, "crm_medico" = NULL WHERE "id" = ${id}`,
        ),
      };
    });

    const crm = { codigo: "23514", constraint: "paciente_crm_medico_formato" };
    const carteirinha = {
      codigo: "23514",
      constraint: "paciente_numero_carteirinha_formato",
    };

    expect(recusas.crmComLetra).toEqual(crm);
    expect(recusas.crmOnzeDigitos).toEqual(crm);
    expect(recusas.crmVazio).toEqual(crm);
    expect(recusas.carteirinhaComEspaco).toEqual(carteirinha);
    expect(recusas.carteirinhaQuatro).toEqual(carteirinha);
    expect(recusas.carteirinhaVinteESeis).toEqual(carteirinha);
    expect(recusas.carteirinhaAcentuada).toEqual(carteirinha);
    expect(recusas.crmDezDigitos).toBeNull();
    expect(recusas.crmUmDigito).toBeNull();
    expect(recusas.carteirinhaCinco).toBeNull();
    expect(recusas.carteirinhaVinteECinco).toBeNull();
    expect(recusas.carteirinhaNula).toBeNull();
  });

  it("o índice único recusa caixa diferente mesmo sem o domínio, e deixa vários NULL", async () => {
    const resultado = await comRollback(async (tx) => {
      const a = await inserirPacienteCru(tx, `Carteirinha Indice A ${SUFIXO}`);
      const b = await inserirPacienteCru(tx, `Carteirinha Indice B ${SUFIXO}`);
      const c = await inserirPacienteCru(tx, `Carteirinha Indice C ${SUFIXO}`);
      const valor = `Idx${SUFIXO}`;

      await tx.$executeRaw`UPDATE "paciente" SET "numero_carteirinha" = ${valor} WHERE "id" = ${a}`;

      return {
        mesmaCaixa: await tentarNoBanco(
          tx,
          (t) =>
            t.$executeRaw`UPDATE "paciente" SET "numero_carteirinha" = ${valor} WHERE "id" = ${b}`,
        ),
        outraCaixa: await tentarNoBanco(
          tx,
          (t) =>
            t.$executeRaw`UPDATE "paciente" SET "numero_carteirinha" = ${valor.toUpperCase()} WHERE "id" = ${b}`,
        ),
        // b e c continuam NULL, lado a lado: o índice é parcial.
        nulos: await tx.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS "n" FROM "paciente"
          WHERE "id" IN (${b}, ${c}) AND "numero_carteirinha" IS NULL
        `,
      };
    });

    const unique = {
      codigo: "23505",
      constraint: "paciente_numero_carteirinha_lower_key",
    };

    expect(resultado.mesmaCaixa).toEqual(unique);
    expect(resultado.outraCaixa).toEqual(unique);
    expect(resultado.nulos[0].n).toBe(2);
  });

  it("paciente antigo, sem carteirinha nem CRM, continua listando", async () => {
    const nome = `Carteirinha Legado ${SUFIXO}`;

    const naLista = await comRollback(async (tx) => {
      // Como um paciente de antes da migration: gravado sem o domínio novo,
      // com as duas colunas nulas.
      const id = await inserirPacienteCru(tx, nome);
      await tx.$executeRaw`
        INSERT INTO "encaminhamento" ("paciente_id", "data_encaminhamento")
        VALUES (${id}, '2026-09-01'::date)
      `;

      const lista = await listarEncaminhamentosNaTransacao(tx);

      return lista.filter((linha) => linha.pacienteId === id);
    });

    expect(naLista).toHaveLength(1);
    expect(naLista[0]).toMatchObject({
      pacienteNome: nome,
      numeroCarteirinha: null,
      crmMedico: null,
      dataEncaminhamento: "2026-09-01",
    });
  });

  it("o domínio recusa antes do banco, com a frase em português", async () => {
    const resultado = await comRollback(async (tx) => ({
      carteirinha: await registrarEncaminhamentoNaTransacao(
        tx,
        entrada(`Carteirinha Dominio ${SUFIXO}`, {
          numeroCarteirinha: "AB-12345",
        }),
      ),
      crm: await registrarEncaminhamentoNaTransacao(
        tx,
        entrada(`Carteirinha Dominio ${SUFIXO}`, { crmMedico: "CRM 1234" }),
      ),
      // Nada foi gravado: a validação roda antes da busca do paciente.
      pacientes: await pacientesComNome(tx, `Carteirinha Dominio ${SUFIXO}`),
    }));

    expect(resultado.carteirinha).toEqual({
      ok: false,
      erro: ERRO_CARTEIRINHA_INVALIDA,
    });
    expect(resultado.crm).toEqual({ ok: false, erro: ERRO_CRM_INVALIDO });
    expect(resultado.pacientes).toHaveLength(0);
  });

  describe("carteirinha obrigatória só enquanto o paciente não tem uma", () => {
    /** A data do encaminhamento do paciente `nome`, ou `null` se não tem. */
    async function dataDoEncaminhamento(
      tx: ClienteDaTransacao,
      nome: string,
    ): Promise<string | null> {
      const [linha] = await tx.$queryRaw<{ data: string }[]>`
        SELECT e."data_encaminhamento"::text AS "data"
        FROM "encaminhamento" e
        JOIN "paciente" p ON p."id" = e."paciente_id"
        WHERE lower(p."nome") = lower(${nome})
      `;

      return linha?.data ?? null;
    }

    /** Paciente de antes de 28/10/2026: sem carteirinha nem CRM, com encaminhamento. */
    async function inserirLegado(
      tx: ClienteDaTransacao,
      nome: string,
    ): Promise<void> {
      const id = await inserirPacienteCru(tx, nome);
      await tx.$executeRaw`
        INSERT INTO "encaminhamento" ("paciente_id", "data_encaminhamento")
        VALUES (${id}, '2026-09-01'::date)
      `;
    }

    // Até 29/10/2026: "paciente novo sem carteirinha é recusado" (pela
    // carteirinha). Desde a regra 24 não há paciente novo no encaminhamento:
    // o nome de ninguém é recusado antes, e nada é criado.
    it("nome não cadastrado é recusado antes da carteirinha, sem criar paciente", async () => {
      const nome = `Obrigatoria Novo ${SUFIXO}`;

      const resultado = await comRollback(async (tx) => ({
        recusa: await registrarEncaminhamentoNaTransacao(
          tx,
          entrada(nome, { numeroCarteirinha: "" }),
        ),
        pacientes: await pacientesComNome(tx, nome),
        encaminhamentos: await contarEncaminhamentos(tx, nome),
      }));

      expect(resultado.recusa).toEqual({
        ok: false,
        erro: ERRO_PACIENTE_FORA_DO_CADASTRO,
      });
      expect(resultado.encaminhamentos).toBe(0);
      expect(resultado.pacientes).toHaveLength(0);
    });

    it("paciente legado sem carteirinha é recusado com a frase própria", async () => {
      const nome = `Obrigatoria Legado ${SUFIXO}`;

      const resultado = await comRollback(async (tx) => {
        await inserirLegado(tx, nome);

        return {
          vazio: await registrarEncaminhamentoNaTransacao(
            tx,
            entrada(nome, {
              numeroCarteirinha: "",
              dataEncaminhamento: "2026-10-20",
            }),
          ),
          soEspacos: await registrarEncaminhamentoNaTransacao(
            tx,
            entrada(nome, { numeroCarteirinha: "  \t  " }),
          ),
          pacientes: await pacientesComNome(tx, nome),
          data: await dataDoEncaminhamento(tx, nome),
        };
      });

      for (const recusa of [resultado.vazio, resultado.soEspacos]) {
        expect(recusa).toEqual({
          ok: false,
          erro: ERRO_CARTEIRINHA_OBRIGATORIA_SEM_CADASTRO,
        });
      }
      // Nada mudou: nem o CRM foi gravado, nem o encaminhamento substituído.
      expect(resultado.pacientes).toHaveLength(1);
      expect(resultado.pacientes[0]).toMatchObject({
        numeroCarteirinha: null,
        crmMedico: null,
      });
      expect(resultado.data).toBe("2026-09-01");
    });

    it.each([
      ["vazio", ""],
      ["só com espaços", "  \u00a0 \t "],
    ])(
      "reenvio com campo %s mantém a carteirinha e atualiza CRM e encaminhamento",
      async (rotulo, campo) => {
        const nome = `Opcional Reenvio ${SUFIXO} ${rotulo}`;
        const carteirinha = carteirinhaDeTeste();

        const resultado = await comRollback(async (tx) => {
          await cadastrado(tx, nome);
          await registrarEncaminhamentoNaTransacao(
            tx,
            entrada(nome, { numeroCarteirinha: carteirinha, crmMedico: "111" }),
          );

          return {
            reenvio: await registrarEncaminhamentoNaTransacao(
              tx,
              entrada(nome, {
                numeroCarteirinha: campo,
                crmMedico: "222.333",
                dataEncaminhamento: "2026-10-20",
              }),
            ),
            pacientes: await pacientesComNome(tx, nome),
            encaminhamentos: await contarEncaminhamentos(tx, nome),
            data: await dataDoEncaminhamento(tx, nome),
          };
        });

        expect(resultado.reenvio).toMatchObject({
          ok: true,
          substituiuAnterior: true,
        });
        expect(resultado.pacientes).toHaveLength(1);
        expect(resultado.pacientes[0]).toMatchObject({
          numeroCarteirinha: carteirinha,
          crmMedico: "222333",
        });
        expect(resultado.encaminhamentos).toBe(1);
        expect(resultado.data).toBe("2026-10-20");
      },
    );

    it("reenvio com a mesma carteirinha não é conflito consigo mesmo", async () => {
      const nome = `Opcional Igual ${SUFIXO}`;
      const carteirinha = carteirinhaDeTeste();

      const resultado = await comRollback(async (tx) => {
        await cadastrado(tx, nome);
        await registrarEncaminhamentoNaTransacao(
          tx,
          entrada(nome, { numeroCarteirinha: carteirinha }),
        );

        return {
          reenvio: await registrarEncaminhamentoNaTransacao(
            tx,
            entrada(nome, { numeroCarteirinha: ` ${carteirinha} ` }),
          ),
          pacientes: await pacientesComNome(tx, nome),
        };
      });

      expect(resultado.reenvio).toMatchObject({ ok: true });
      expect(resultado.pacientes).toHaveLength(1);
      expect(resultado.pacientes[0].numeroCarteirinha).toBe(carteirinha);
    });

    it("reenvio com carteirinha nova válida atualiza", async () => {
      const nome = `Opcional Nova ${SUFIXO}`;
      const antiga = carteirinhaDeTeste();
      const nova = carteirinhaDeTeste();

      const resultado = await comRollback(async (tx) => {
        await cadastrado(tx, nome);
        await registrarEncaminhamentoNaTransacao(
          tx,
          entrada(nome, { numeroCarteirinha: antiga }),
        );

        return {
          reenvio: await registrarEncaminhamentoNaTransacao(
            tx,
            entrada(nome, { numeroCarteirinha: nova }),
          ),
          pacientes: await pacientesComNome(tx, nome),
        };
      });

      expect(resultado.reenvio).toMatchObject({ ok: true });
      expect(resultado.pacientes).toHaveLength(1);
      expect(resultado.pacientes[0].numeroCarteirinha).toBe(nova);
    });

    it("reenvio com carteirinha de outro paciente é recusado com o nome do dono", async () => {
      const dono = `Opcional Dono ${SUFIXO}`;
      const nome = `Opcional Proprio ${SUFIXO}`;
      const doDono = carteirinhaDeTeste();
      const propria = carteirinhaDeTeste();

      const resultado = await comRollback(async (tx) => {
        await cadastrado(tx, dono, nome);
        await registrarEncaminhamentoNaTransacao(
          tx,
          entrada(dono, { numeroCarteirinha: doDono }),
        );
        await registrarEncaminhamentoNaTransacao(
          tx,
          entrada(nome, { numeroCarteirinha: propria, crmMedico: "111" }),
        );

        return {
          recusa: await registrarEncaminhamentoNaTransacao(
            tx,
            entrada(nome, {
              numeroCarteirinha: doDono.toLowerCase(),
              crmMedico: "999",
            }),
          ),
          pacientes: await pacientesComNome(tx, nome),
        };
      });

      expect(resultado.recusa).toEqual({
        ok: false,
        erro: erroCarteirinhaDeOutroPaciente(dono),
      });
      expect(resultado.pacientes[0]).toMatchObject({
        numeroCarteirinha: propria,
        crmMedico: "111",
      });
    });
  });
});

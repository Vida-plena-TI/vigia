/**
 * Situação da requisição ("solicitada" / "aprovada") contra o Postgres real.
 *
 * O que este arquivo prova, e por que cada prova precisa do banco:
 *
 *   1. **A migration de backfill**, lida do arquivo em disco e reaplicada sobre
 *      uma cópia temporária de `requisicao` (mesma técnica do teste da
 *      migration de `papel`, em `lib/auth/criar-usuario.integration.test.ts`):
 *      as linhas antigas saem "aprovada", e a coluna fica NOT NULL sem default.
 *   2. **O CHECK `requisicao_situacao_valida`** recusa valor fora de
 *      `SITUACOES_DE_REQUISICAO`, e inserir sem situação falha (não há default).
 *   3. **Criação**: requisição nova nasce "solicitada"; acrescentar ou
 *      atualizar terapia numa requisição existente não muda a situação.
 *   4. **A Server Action**: admin altera; recepção é recusada chamando a
 *      action direto (o papel é lido do banco — só a sessão é dublê).
 *   5. **O bloqueio do lançamento**: requisição solicitada recusa o lote e não
 *      grava nada; lote misto é recusado inteiro; depois de aprovar, o mesmo
 *      lote passa. Editar e excluir atendimento continuam permitidos.
 *   6. **A corrida** com o `FOR SHARE`: lançamento segurando o lock faz a
 *      mudança de situação esperar (confirmado no `pg_stat_activity`), e o
 *      contrário faz o lançamento esperar e decidir com a situação nova.
 *   7. **A listagem** de guias disponíveis traz a situação, para a tela
 *      desabilitar as de requisição solicitada.
 *
 * Contrato de execução igual ao dos outros testes de integração: sem
 * DATABASE_URL os blocos são pulados; o bloco com rollback não deixa lixo; os
 * blocos que precisam commitar (a action, a listagem pelo cliente global e as
 * corridas) usam nomes sufixados e apagam tudo no `afterAll`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MENSAGEM_SEM_PERMISSAO } from "@/lib/auth/acesso";
import { getPrismaClient } from "@/lib/db";

import {
  editarAtendimentoNaTransacao,
  erroRequisicaoSolicitada,
  excluirAtendimentoNaTransacao,
  lancarLote,
  lancarLoteNaTransacao,
  listarGuiasDisponiveisDoPaciente,
  type EntradaDeLote,
  type ResultadoDoLote,
} from "./atendimentos";
import { cadastrarPacienteDeTeste } from "@/test/paciente-cadastrado";
import { registrarEncaminhamentoNaTransacao } from "./encaminhamentos";
import {
  alterarSituacaoDaRequisicao,
  criarRequisicaoNaTransacao,
  type ResultadoAlteracaoDeSituacao,
} from "./requisicoes";
import type { SituacaoDeRequisicao } from "./situacao-requisicao";

// Só a sessão (o cookie) e o `revalidatePath` são dublês: `requireUsuario`
// roda de verdade e lê o papel do Postgres.
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getSession: mocks.getSession }));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
  refresh: vi.fn(),
}));

const temBanco = Boolean(process.env.DATABASE_URL);

/** Sufixo único para não colidir com dados já existentes no banco de dev. */
const SUFIXO = Math.random().toString(36).slice(2, 10);

/**
 * Carteirinha sintética e única por chamada: o índice único da carteirinha é
 * global, e cada encaminhamento de teste é de um paciente diferente.
 */
function carteirinhaDeTeste(): string {
  return `T${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

const DATA = "2026-01-15";

const CAMINHO_DA_MIGRATION = fileURLToPath(
  new URL(
    "../../prisma/migrations/20261026130000_situacao_da_requisicao/migration.sql",
    import.meta.url,
  ),
);

afterAll(async () => {
  await getPrismaClient().$disconnect();
}, 60_000);

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

/** Ids de tudo que um cenário criou, para a limpeza saber o que apagar. */
type Cenario = {
  pacienteId: number;
  requisicaoIds: number[];
  terapiaIds: number[];
  /** Uma guia por requisição, na mesma ordem de `requisicaoIds`. */
  guiaIds: number[];
};

/**
 * Um paciente com uma requisição por situação informada, cada uma com uma
 * guia (de terapia própria) de `qtdAutorizada` créditos.
 *
 * A requisição é criada direto no banco, com a situação explícita — a coluna
 * não tem default.
 */
async function criarCenario(
  cliente: ClienteDaTransacao,
  rotulo: string,
  situacoes: SituacaoDeRequisicao[],
  qtdAutorizada = 10,
): Promise<Cenario> {
  const paciente = await cliente.paciente.create({
    data: { nome: `Paciente Situacao ${rotulo} ${SUFIXO}` },
  });

  const cenario: Cenario = {
    pacienteId: paciente.id,
    requisicaoIds: [],
    terapiaIds: [],
    guiaIds: [],
  };

  for (const [indice, situacao] of situacoes.entries()) {
    const requisicao = await cliente.requisicao.create({
      data: {
        numeroRequisicao: `SIT-${rotulo}-${indice}-${SUFIXO}`,
        pacienteId: paciente.id,
        situacao,
      },
    });

    const terapia = await cliente.terapia.create({
      data: {
        nome: `Terapia Situacao ${rotulo} ${indice} ${SUFIXO}`,
        codigoTiss: `S${indice}`,
      },
    });

    const guia = await cliente.requisicaoTerapia.create({
      data: { requisicaoId: requisicao.id, terapiaId: terapia.id, qtdAutorizada },
    });

    cenario.requisicaoIds.push(requisicao.id);
    cenario.terapiaIds.push(terapia.id);
    cenario.guiaIds.push(guia.id);
  }

  return cenario;
}

/**
 * Apaga um cenário commitado. Mesma postura de `apagarCenario` em
 * `atendimentos.integration.test.ts`: cada DELETE no seu `try`, e o que não
 * for apagado sai no `console.error` com o id.
 */
async function apagarCenario(cenario: Cenario): Promise<void> {
  const prisma = getPrismaClient();
  const passos: { rotulo: string; apagar: () => Promise<unknown> }[] = [
    {
      rotulo: `requisicao_terapia ${cenario.guiaIds.join(", ")}`,
      apagar: () =>
        prisma.requisicaoTerapia.deleteMany({ where: { id: { in: cenario.guiaIds } } }),
    },
    {
      rotulo: `requisicao ${cenario.requisicaoIds.join(", ")}`,
      apagar: () =>
        prisma.requisicao.deleteMany({ where: { id: { in: cenario.requisicaoIds } } }),
    },
    {
      rotulo: `paciente ${cenario.pacienteId}`,
      apagar: () => prisma.paciente.deleteMany({ where: { id: cenario.pacienteId } }),
    },
    {
      rotulo: `terapia ${cenario.terapiaIds.join(", ")}`,
      apagar: () =>
        prisma.terapia.deleteMany({ where: { id: { in: cenario.terapiaIds } } }),
    },
  ];

  for (const passo of passos) {
    try {
      await passo.apagar();
    } catch (erro) {
      console.error(
        `[situacao-requisicao.integration] limpeza NAO apagou ${passo.rotulo}; o dado continua no banco.`,
        erro,
      );
    }
  }
}

async function situacaoNoBanco(
  cliente: ClienteDaTransacao,
  requisicaoId: number,
): Promise<string> {
  const requisicao = await cliente.requisicao.findUniqueOrThrow({
    where: { id: requisicaoId },
    select: { situacao: true },
  });

  return requisicao.situacao;
}

function loteDe(
  pacienteId: number,
  guiaIds: number[],
  creditos = 1,
): EntradaDeLote {
  return {
    pacienteId,
    dataAtendimento: DATA,
    observacao: null,
    itens: guiaIds.map((requisicaoTerapiaId) => ({
      requisicaoTerapiaId,
      creditosConsumidos: creditos,
    })),
  };
}

/** Quebra o arquivo de migration em comandos apontados para `alvo`. */
function comandosDaMigration(sql: string, alvo: string): string[] {
  return sql
    .split("\n")
    .filter((linha) => !linha.trimStart().startsWith("--"))
    .join("\n")
    .replaceAll('"requisicao"', `"${alvo}"`)
    .split(";")
    .map((comando) => comando.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Regras com rollback
// ---------------------------------------------------------------------------

describe.skipIf(!temBanco)("situação da requisição — schema e regras", () => {
  it("a migration backfilla com 'aprovada' as requisições que já existiam", async () => {
    const alvo = `requisicao_pre_situacao_${SUFIXO}`;
    const comandos = comandosDaMigration(
      readFileSync(CAMINHO_DA_MIGRATION, "utf8"),
      alvo,
    );

    // Exatamente os três comandos que este teste exercita: um quarto comando
    // acrescentado à migration faz o teste falhar em vez de passar calado.
    expect(comandos).toHaveLength(3);

    const resultado = await comRollback(async (tx) => {
      // A tabela como era ANTES da migration: sem `situacao`, com as linhas de
      // verdade do banco. Temporária porque o role de runtime pode não ser dono
      // de `requisicao`; os dados são os reais.
      await tx.$executeRawUnsafe(
        `CREATE TEMP TABLE "${alvo}" ON COMMIT DROP AS
         SELECT "id", "numero_requisicao", "paciente_id" FROM "requisicao"`,
      );

      // Duas linhas "antigas" a mais, para a prova valer num banco vazio.
      await tx.$executeRawUnsafe(
        `INSERT INTO "${alvo}" ("id", "numero_requisicao", "paciente_id")
         VALUES (-1, 'antiga-1', -1), (-2, 'antiga-2', -2)`,
      );

      const antes = await tx.$queryRawUnsafe<{ total: bigint }[]>(
        `SELECT count(*)::bigint AS total FROM "${alvo}"`,
      );

      for (const comando of comandos) {
        await tx.$executeRawUnsafe(comando);
      }

      const porSituacao = await tx.$queryRawUnsafe<
        { situacao: string; total: bigint }[]
      >(
        `SELECT "situacao", count(*)::bigint AS total FROM "${alvo}" GROUP BY "situacao"`,
      );

      const coluna = await tx.$queryRawUnsafe<
        { table_name: string; is_nullable: string; column_default: string | null }[]
      >(
        `SELECT c.table_name, c.is_nullable, c.column_default
           FROM information_schema.columns c
          WHERE c.column_name = 'situacao'
            AND c.table_name IN ('requisicao', $1)`,
        alvo,
      );

      // Escopado por `conrelid`: a cópia carrega um CHECK homônimo.
      const checksDaCopia = await tx.$queryRawUnsafe<{ total: bigint }[]>(
        `SELECT count(*)::bigint AS total
           FROM pg_constraint
          WHERE contype = 'c'
            AND conrelid = $1::regclass
            AND pg_get_constraintdef(oid) ILIKE '%situacao%'`,
        alvo,
      );

      const checkDaTabelaReal = await tx.$queryRawUnsafe<{ def: string }[]>(
        `SELECT pg_get_constraintdef(oid) AS def
           FROM pg_constraint
          WHERE conname = 'requisicao_situacao_valida'
            AND contype = 'c'
            AND conrelid = 'public.requisicao'::regclass`,
      );

      return {
        linhas: Number(antes[0].total),
        porSituacao: porSituacao.map((l) => ({
          situacao: l.situacao,
          total: Number(l.total),
        })),
        coluna,
        checksDaCopia: Number(checksDaCopia[0].total),
        checkDaTabelaReal: checkDaTabelaReal.map((l) => l.def),
      };
    });

    expect(resultado.linhas).toBeGreaterThanOrEqual(2);

    // Toda linha que existia saiu "aprovada": um grupo só, cobrindo a tabela.
    expect(resultado.porSituacao).toEqual([
      { situacao: "aprovada", total: resultado.linhas },
    ]);

    // NOT NULL e sem default, na cópia e na tabela de verdade.
    expect(resultado.coluna).toHaveLength(2);
    for (const coluna of resultado.coluna) {
      expect(coluna.is_nullable).toBe("NO");
      expect(coluna.column_default).toBeNull();
    }

    expect(resultado.checksDaCopia).toBe(1);
    expect(resultado.checkDaTabelaReal).toHaveLength(1);
    expect(resultado.checkDaTabelaReal[0]).toMatch(/'solicitada'/);
    expect(resultado.checkDaTabelaReal[0]).toMatch(/'aprovada'/);
  });

  it("o CHECK recusa situação fora da lista", async () => {
    await expect(
      comRollback(async (tx) => {
        const paciente = await tx.paciente.create({
          data: { nome: `Paciente Check Situacao ${SUFIXO}` },
        });

        // `situacao` é `String` no Prisma: só o CHECK do Postgres barra.
        await tx.requisicao.create({
          data: {
            numeroRequisicao: `CHK-SIT-${SUFIXO}`,
            pacienteId: paciente.id,
            situacao: "rejeitada",
          },
        });
      }),
    ).rejects.toThrow(/requisicao_situacao_valida|check constraint/i);
  });

  it("inserir requisição sem situação falha: a coluna não tem default", async () => {
    await expect(
      comRollback(async (tx) => {
        const paciente = await tx.paciente.create({
          data: { nome: `Paciente Sem Situacao ${SUFIXO}` },
        });

        await tx.$executeRaw`
          INSERT INTO "requisicao" ("numero_requisicao", "paciente_id")
          VALUES (${`SEM-SIT-${SUFIXO}`}, ${paciente.id})
        `;
      }),
    ).rejects.toThrow(/situacao|not-null|null value/i);
  });

  it("requisição nova nasce 'solicitada'; acrescentar terapia não muda a situação", async () => {
    const resultado = await comRollback(async (tx) => {
      const pacienteNome = `Paciente Criacao Situacao ${SUFIXO}`;
      const numeroRequisicao = `CRIA-SIT-${SUFIXO}`;

      await cadastrarPacienteDeTeste(tx, pacienteNome);
      const encaminhamento = await registrarEncaminhamentoNaTransacao(tx, {
        pacienteNome,
        dataEncaminhamento: "2026-10-01",
        numeroCarteirinha: carteirinhaDeTeste(),
        crmMedico: "123456",
      });
      if (!encaminhamento.ok) throw new Error(encaminhamento.erro);

      const terapias = await Promise.all(
        [0, 1].map((indice) =>
          tx.terapia.create({
            data: {
              nome: `Terapia Criacao Situacao ${indice} ${SUFIXO}`,
              codigoTiss: `C${indice}`,
            },
          }),
        ),
      );

      const criada = await criarRequisicaoNaTransacao(tx, {
        pacienteNome,
        numeroRequisicao,
        linhas: [{ terapiaId: terapias[0].id, qtdAutorizada: 8, validade: null }],
      });
      if (!criada.ok) throw new Error(criada.erro);

      const aoNascer = await situacaoNoBanco(tx, criada.requisicaoId);

      // Aprovada à mão; o envio seguinte com o mesmo número atualiza a guia
      // que existe e acrescenta outra — e a situação tem de continuar.
      await tx.requisicao.update({
        where: { id: criada.requisicaoId },
        data: { situacao: "aprovada" },
      });

      const acrescimo = await criarRequisicaoNaTransacao(tx, {
        pacienteNome,
        numeroRequisicao,
        linhas: [
          { terapiaId: terapias[0].id, qtdAutorizada: 12, validade: null },
          { terapiaId: terapias[1].id, qtdAutorizada: 4, validade: null },
        ],
      });
      if (!acrescimo.ok) throw new Error(acrescimo.erro);

      return {
        aoNascer,
        acrescimo,
        depoisDoAcrescimo: await situacaoNoBanco(tx, criada.requisicaoId),
        mesmaRequisicao: acrescimo.requisicaoId === criada.requisicaoId,
      };
    });

    expect(resultado.aoNascer).toBe("solicitada");
    expect(resultado.mesmaRequisicao).toBe(true);
    expect(resultado.acrescimo).toMatchObject({
      requisicaoCriada: false,
      terapiasAdicionadas: 1,
      terapiasAtualizadas: 1,
    });
    expect(resultado.depoisDoAcrescimo).toBe("aprovada");
  });

  it("acrescentar terapia a requisição solicitada a mantém solicitada", async () => {
    const depois = await comRollback(async (tx) => {
      const pacienteNome = `Paciente Acrescimo Solicitada ${SUFIXO}`;
      const numeroRequisicao = `ACR-SIT-${SUFIXO}`;

      await cadastrarPacienteDeTeste(tx, pacienteNome);
      const encaminhamento = await registrarEncaminhamentoNaTransacao(tx, {
        pacienteNome,
        dataEncaminhamento: "2026-10-01",
        numeroCarteirinha: carteirinhaDeTeste(),
        crmMedico: "123456",
      });
      if (!encaminhamento.ok) throw new Error(encaminhamento.erro);

      const [a, b] = await Promise.all(
        [0, 1].map((indice) =>
          tx.terapia.create({
            data: {
              nome: `Terapia Acrescimo Situacao ${indice} ${SUFIXO}`,
              codigoTiss: `D${indice}`,
            },
          }),
        ),
      );

      const criada = await criarRequisicaoNaTransacao(tx, {
        pacienteNome,
        numeroRequisicao,
        linhas: [{ terapiaId: a.id, qtdAutorizada: 8, validade: null }],
      });
      if (!criada.ok) throw new Error(criada.erro);

      await criarRequisicaoNaTransacao(tx, {
        pacienteNome,
        numeroRequisicao,
        linhas: [{ terapiaId: b.id, qtdAutorizada: 8, validade: null }],
      });

      return situacaoNoBanco(tx, criada.requisicaoId);
    });

    expect(depois).toBe("solicitada");
  });

  it("lançamento em requisição solicitada é recusado e não grava nada", async () => {
    const { resultado, atendimentos, numero } = await comRollback(async (tx) => {
      const cenario = await criarCenario(tx, "RECUSA", ["solicitada"]);
      const resultado = await lancarLoteNaTransacao(
        tx,
        loteDe(cenario.pacienteId, cenario.guiaIds),
      );
      const requisicao = await tx.requisicao.findUniqueOrThrow({
        where: { id: cenario.requisicaoIds[0] },
      });

      return {
        resultado,
        numero: requisicao.numeroRequisicao,
        atendimentos: await tx.atendimento.count({
          where: { requisicaoTerapiaId: { in: cenario.guiaIds } },
        }),
      };
    });

    expect(resultado).toEqual({
      ok: false,
      erro: erroRequisicaoSolicitada(numero),
      item: 0,
    });
    // A mensagem cita o número da requisição.
    expect(resultado.ok === false && resultado.erro).toContain(numero);
    expect(atendimentos).toBe(0);
  });

  it("lote misto (uma guia aprovada, uma solicitada) é recusado por inteiro", async () => {
    const { resultado, atendimentos, numeroSolicitada } = await comRollback(
      async (tx) => {
        // A aprovada vem primeiro no lote: se a recusa fosse por item, ela
        // seria gravada antes de a solicitada ser vista.
        const cenario = await criarCenario(tx, "MISTO", ["aprovada", "solicitada"]);
        const resultado = await lancarLoteNaTransacao(
          tx,
          loteDe(cenario.pacienteId, cenario.guiaIds),
        );
        const solicitada = await tx.requisicao.findUniqueOrThrow({
          where: { id: cenario.requisicaoIds[1] },
        });

        return {
          resultado,
          numeroSolicitada: solicitada.numeroRequisicao,
          atendimentos: await tx.atendimento.count({
            where: { requisicaoTerapiaId: { in: cenario.guiaIds } },
          }),
        };
      },
    );

    expect(resultado).toEqual({
      ok: false,
      erro: erroRequisicaoSolicitada(numeroSolicitada),
      item: 1,
    });
    expect(atendimentos).toBe(0);
  });

  it("editar e excluir atendimento continuam funcionando em requisição solicitada", async () => {
    const resultado = await comRollback(async (tx) => {
      const cenario = await criarCenario(tx, "EDITA", ["aprovada"]);

      const lancado = await lancarLoteNaTransacao(
        tx,
        loteDe(cenario.pacienteId, cenario.guiaIds, 2),
      );
      if (!lancado.ok) throw new Error(lancado.erro);

      const [primeiro] = await tx.atendimento.findMany({
        where: { requisicaoTerapiaId: cenario.guiaIds[0] },
      });
      const segundo = await tx.atendimento.create({
        data: {
          requisicaoTerapiaId: cenario.guiaIds[0],
          dataAtendimento: new Date(`${DATA}T00:00:00.000Z`),
          creditosConsumidos: 1,
        },
      });

      // A requisição volta para "solicitada" depois dos lançamentos.
      await tx.requisicao.update({
        where: { id: cenario.requisicaoIds[0] },
        data: { situacao: "solicitada" },
      });

      const edicao = await editarAtendimentoNaTransacao(tx, {
        atendimentoId: primeiro.id,
        dataAtendimento: DATA,
        creditosConsumidos: 3,
        observacao: "editado com a requisição solicitada",
      });

      const exclusao = await excluirAtendimentoNaTransacao(tx, segundo.id);

      const restantes = await tx.atendimento.findMany({
        where: { requisicaoTerapiaId: cenario.guiaIds[0] },
        select: { creditosConsumidos: true },
      });

      // E lançar de novo continua bloqueado.
      const novoLote = await lancarLoteNaTransacao(
        tx,
        loteDe(cenario.pacienteId, cenario.guiaIds),
      );

      return { edicao, exclusao, restantes, novoLote };
    });

    expect(resultado.edicao).toMatchObject({ ok: true, totalUtilizado: 4 });
    expect(resultado.exclusao).toEqual({ ok: true });
    expect(resultado.restantes).toEqual([{ creditosConsumidos: 3 }]);
    expect(resultado.novoLote.ok).toBe(false);
  });

  it("recusa situação inválida e requisição inexistente sem tocar no banco", async () => {
    expect(await alterarSituacaoDaRequisicao(1, "rejeitada")).toMatchObject({
      ok: false,
    });
    expect(await alterarSituacaoDaRequisicao(0, "aprovada")).toMatchObject({
      ok: false,
    });
    expect(
      await alterarSituacaoDaRequisicao(2_000_000_000, "aprovada"),
    ).toMatchObject({ ok: false });
  });
});

// ---------------------------------------------------------------------------
// Action, listagem e lançamento com dados commitados
// ---------------------------------------------------------------------------

describe.skipIf(!temBanco)("situação da requisição — action e lançamento", () => {
  let cenario: Cenario | null = null;
  const usuarioIds: number[] = [];

  afterAll(async () => {
    if (cenario) {
      await apagarCenario(cenario);
    }
    try {
      await getPrismaClient().usuario.deleteMany({ where: { id: { in: usuarioIds } } });
    } catch (erro) {
      console.error(
        `[situacao-requisicao.integration] limpeza NAO apagou usuario(s) ${usuarioIds.join(", ")}.`,
        erro,
      );
    }
  }, 60_000);

  beforeEach(() => {
    vi.clearAllMocks();
    // `getUsuarioAtual` é memoizado com o `cache` do React; módulos novos a
    // cada teste garantem que a decisão sai do usuário deste teste.
    vi.resetModules();
  });

  /** Cria um usuário real no banco e põe o id dele na sessão dublê. */
  async function logarComo(papel: "admin" | "recepcao"): Promise<void> {
    const usuario = await getPrismaClient().usuario.create({
      data: {
        username: `teste-situacao-${papel}-${SUFIXO}-${usuarioIds.length}`,
        passwordHash: "hash-de-teste",
        ativo: true,
        papel,
      },
    });
    usuarioIds.push(usuario.id);

    // O cookie diz "admin" sempre: se a decisão viesse dele, a recepção
    // passaria. Quem decide é o papel do banco.
    mocks.getSession.mockResolvedValue({ usuarioId: usuario.id, papel: "admin" });
  }

  async function chamarAction(
    requisicaoId: number,
    situacao: string,
  ): Promise<ResultadoAlteracaoDeSituacao> {
    const { alterarSituacaoDaRequisicaoAction } = await import(
      "./situacao-requisicao-actions"
    );

    return alterarSituacaoDaRequisicaoAction(requisicaoId, situacao);
  }

  // Uma requisição aprovada e uma solicitada do mesmo paciente. Os testes
  // abaixo rodam em sequência sobre este cenário (aprovar, lançar, voltar).
  beforeAll(async () => {
    cenario = await criarCenario(getPrismaClient(), "ACTION", [
      "aprovada",
      "solicitada",
    ]);
  }, 60_000);

  it("a listagem de guias disponíveis marca a de requisição solicitada", async () => {
    const guias = await listarGuiasDisponiveisDoPaciente(cenario!.pacienteId);

    expect(
      guias.map((guia) => ({ id: guia.id, situacao: guia.situacaoRequisicao })),
    ).toEqual(
      expect.arrayContaining([
        { id: cenario!.guiaIds[0], situacao: "aprovada" },
        { id: cenario!.guiaIds[1], situacao: "solicitada" },
      ]),
    );
    expect(guias).toHaveLength(2);
  });

  it("recepção chamando a action direto é recusada e nada muda", async () => {
    await logarComo("recepcao");

    expect(await chamarAction(cenario!.requisicaoIds[1], "aprovada")).toEqual({
      ok: false,
      erro: MENSAGEM_SEM_PERMISSAO,
    });
    expect(await situacaoNoBanco(getPrismaClient(), cenario!.requisicaoIds[1])).toBe(
      "solicitada",
    );
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("lançar na solicitada é recusado; o lote misto também, sem gravar nada", async () => {
    const soSolicitada = await lancarLote(
      loteDe(cenario!.pacienteId, [cenario!.guiaIds[1]]),
    );
    const misto = await lancarLote(loteDe(cenario!.pacienteId, cenario!.guiaIds));

    expect(soSolicitada.ok).toBe(false);
    expect(misto.ok).toBe(false);
    expect(
      await getPrismaClient().atendimento.count({
        where: { requisicaoTerapiaId: { in: cenario!.guiaIds } },
      }),
    ).toBe(0);
  });

  it("admin aprova pela action, e o mesmo lote misto passa", async () => {
    await logarComo("admin");

    const aprovada = await chamarAction(cenario!.requisicaoIds[1], "aprovada");
    expect(aprovada).toMatchObject({ ok: true, situacao: "aprovada" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/klini/dashboard");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/klini/atendimentos/novo");

    // Idempotente: aprovar o que já está aprovado não é erro.
    expect(await chamarAction(cenario!.requisicaoIds[1], "aprovada")).toMatchObject({
      ok: true,
      situacao: "aprovada",
    });

    const misto = await lancarLote(loteDe(cenario!.pacienteId, cenario!.guiaIds));
    expect(misto).toEqual({ ok: true, totalDeAtendimentos: 2, totalDeCreditos: 2 });
  });

  it("admin volta para solicitada (corrigir clique errado) e o lançamento volta a ser bloqueado", async () => {
    await logarComo("admin");

    expect(await chamarAction(cenario!.requisicaoIds[1], "solicitada")).toMatchObject({
      ok: true,
      situacao: "solicitada",
    });

    const lote = await lancarLote(loteDe(cenario!.pacienteId, [cenario!.guiaIds[1]]));
    expect(lote.ok).toBe(false);
  });

  it("admin recebe erro, não exceção, para situação fora da lista", async () => {
    await logarComo("admin");

    expect(await chamarAction(cenario!.requisicaoIds[1], "rejeitada")).toMatchObject({
      ok: false,
    });
    expect(await situacaoNoBanco(getPrismaClient(), cenario!.requisicaoIds[1])).toBe(
      "solicitada",
    );
  });
});

// ---------------------------------------------------------------------------
// Corrida entre lançamento e mudança de situação
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

/**
 * `true` quando outra conexão está parada esperando lock **no comando que
 * mexe na situação**: o UPDATE da situação ou o `FOR SHARE` do lançamento.
 * Mais estreito que o de `atendimentos.integration.test.ts` (qualquer lock),
 * para provar que quem bloqueou foi a linha de `requisicao`, e não a guia.
 */
async function existeConexaoBloqueadaEmRequisicao(): Promise<boolean> {
  const [linha] = await getPrismaClient().$queryRaw<{ total: bigint }[]>`
    SELECT count(*) AS "total"
    FROM pg_stat_activity a
    WHERE a."datname" = current_database()
      AND a."pid" <> pg_backend_pid()
      AND a."wait_event_type" = 'Lock'
      AND (a."query" ILIKE '%UPDATE "requisicao"%' OR a."query" ILIKE '%FOR SHARE%')
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

describe.skipIf(!temBanco)("corrida entre lançamento e situação", () => {
  const criados: Cenario[] = [];

  afterAll(async () => {
    for (const cenario of criados) {
      await apagarCenario(cenario);
    }
  }, 60_000);

  it("lançamento segurando o lock faz a volta para 'solicitada' esperar", async () => {
    const cenario = await criarCenario(getPrismaClient(), "CORRIDA1", ["aprovada"]);
    criados.push(cenario);
    const lote = loteDe(cenario.pacienteId, cenario.guiaIds);

    await aquecerPool();

    const portao = criarPortao();
    let resultadoA: ResultadoDoLote | null = null;
    let bTerminou = false;

    // A: lança (trava guia e requisição) e para no portão, sem commitar.
    const transacaoA = getPrismaClient().$transaction(
      async (tx) => {
        resultadoA = await lancarLoteNaTransacao(tx, lote);
        await portao.promessa;

        return resultadoA;
      },
      { maxWait: 30_000, timeout: 30_000 },
    );

    const pendentes: Promise<unknown>[] = [transacaoA];

    try {
      expect(await esperarAte(() => resultadoA !== null, 10_000)).toBe(true);
      expect(resultadoA).toMatchObject({ ok: true });

      // B: a função de produção, com A ainda aberta. O UPDATE bate no
      // FOR SHARE de A.
      const transacaoB = alterarSituacaoDaRequisicao(
        cenario.requisicaoIds[0],
        "solicitada",
      ).finally(() => {
        bTerminou = true;
      });
      pendentes.push(transacaoB);

      expect(await esperarAte(existeConexaoBloqueadaEmRequisicao, 2_000)).toBe(true);
      // Bloqueada de fato: ainda não respondeu e a situação não mudou.
      expect(bTerminou).toBe(false);
      expect(await situacaoNoBanco(getPrismaClient(), cenario.requisicaoIds[0])).toBe(
        "aprovada",
      );

      portao.abrir();

      const [a, b] = await Promise.all([transacaoA, transacaoB]);

      // Ordem coerente: o atendimento de A entrou (decidido com "aprovada"),
      // e só depois B gravou "solicitada".
      expect(a).toEqual({ ok: true, totalDeAtendimentos: 1, totalDeCreditos: 1 });
      expect(b).toMatchObject({ ok: true, situacao: "solicitada" });
      expect(
        await getPrismaClient().atendimento.count({
          where: { requisicaoTerapiaId: cenario.guiaIds[0] },
        }),
      ).toBe(1);

      // E daqui em diante o lançamento está bloqueado.
      const depois = await lancarLote(lote);
      expect(depois.ok).toBe(false);
    } finally {
      portao.abrir();
      await Promise.allSettled(pendentes);
    }
  }, 60_000);

  it("mudança para 'solicitada' em curso faz o lançamento esperar e decidir com a situação nova", async () => {
    const cenario = await criarCenario(getPrismaClient(), "CORRIDA2", ["aprovada"]);
    criados.push(cenario);
    const lote = loteDe(cenario.pacienteId, cenario.guiaIds);

    await aquecerPool();

    const portao = criarPortao();
    let aGravou = false;

    // A: o mesmo UPDATE de `alterarSituacaoDaRequisicao`, dentro de uma
    // transação que para no portão segurando o lock da linha.
    const transacaoA = getPrismaClient().$transaction(
      async (tx) => {
        await tx.$executeRaw`
          UPDATE "requisicao" SET "situacao" = 'solicitada'
          WHERE "id" = ${cenario.requisicaoIds[0]}
        `;
        aGravou = true;
        await portao.promessa;
      },
      { maxWait: 30_000, timeout: 30_000 },
    );

    const pendentes: Promise<unknown>[] = [transacaoA];

    try {
      expect(await esperarAte(() => aGravou, 10_000)).toBe(true);

      // B: lançamento de produção. Trava a guia sem problema, e o FOR SHARE da
      // requisição espera A.
      const transacaoB = lancarLote(lote);
      pendentes.push(transacaoB);

      expect(await esperarAte(existeConexaoBloqueadaEmRequisicao, 2_000)).toBe(true);

      portao.abrir();
      await transacaoA;
      const b = await transacaoB;

      // B leu a situação já commitada por A — não a do snapshot anterior.
      expect(b.ok).toBe(false);
      expect(b.ok === false && b.erro).toContain("Solicitada");
      expect(
        await getPrismaClient().atendimento.count({
          where: { requisicaoTerapiaId: cenario.guiaIds[0] },
        }),
      ).toBe(0);
    } finally {
      portao.abrir();
      await Promise.allSettled(pendentes);
    }
  }, 60_000);
});

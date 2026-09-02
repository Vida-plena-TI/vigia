/**
 * Lançamento de atendimento contra o Postgres real (regra 7 do CONTEXT.md).
 *
 * O teste unitário (`atendimentos.test.ts`) prova que a validação sem banco
 * decide certo. Este aqui cobre o que só existe no banco: o saldo vindo da
 * view, a guia inexistente e — o principal — a **corrida de saldo** entre dois
 * lançamentos simultâneos na mesma guia.
 *
 * Como roda (mesmo contrato de `saldo.integration.test.ts` e
 * `guias.integration.test.ts`):
 *
 *     npm test -- atendimentos.integration
 *
 *   - precisa de DATABASE_URL com as migrations aplicadas
 *     (`npm run db:migrate:dev`); sem ela os blocos são pulados em vez de
 *     falhar, para `npm test` continuar útil em CI sem banco;
 *   - o bloco de regras roda dentro de uma transação que sempre sofre
 *     rollback, então não deixa lixo;
 *   - o bloco de concorrência **precisa** commitar (é justamente o commit de
 *     uma transação que a outra tem de enxergar), então ele cria dados de
 *     verdade, com nomes sufixados por um valor aleatório, e apaga tudo no
 *     `afterAll`.
 *
 * ## O que o teste de concorrência prova
 *
 * Guia com `qtd_autorizada = 3` e nenhum atendimento. Dois lotes pedindo 2
 * créditos cada: cabem individualmente, não cabem juntos (2 + 2 > 3).
 *
 * A interleaving é forçada, não sorteada — um teste que só dispara os dois
 * lotes e torce para colidirem passaria por acidente:
 *
 *   1. a transação A trava a guia, lê saldo 3, insere 2 créditos e **para**,
 *      segurando o lock com a transação ainda aberta;
 *   2. a transação B começa e fica bloqueada no `SELECT ... FOR UPDATE`. O
 *      teste confirma o bloqueio olhando o `pg_stat_activity` — não é um
 *      `sleep` esperançoso;
 *   3. A commita. B destrava, e o `SELECT` seguinte (comando novo, snapshot
 *      novo em READ COMMITTED) enxerga o atendimento de A: saldo 1, pedido 2,
 *      recusado.
 *
 * Se o lock não existisse, B leria saldo 3 no snapshot antigo e as duas
 * gravariam — 4 créditos numa guia de 3. É exatamente esse cenário que o
 * `expect` final descarta, conferindo `qtd_utilizada` na view no fim.
 */
import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";

import {
  ERRO_ATENDIMENTO_ID_INVALIDO,
  ERRO_ATENDIMENTO_INEXISTENTE,
  ERRO_CREDITOS_EDICAO_INVALIDOS,
  ERRO_GUIA_DE_OUTRO_PACIENTE,
  ERRO_GUIA_INEXISTENTE,
  editarAtendimentoNaTransacao,
  editarAtendimentoPeloId,
  excluirAtendimentoNaTransacao,
  excluirAtendimentoPeloId,
  lancarLote,
  lancarLoteNaTransacao,
  listarGuiasDisponiveisDoPaciente,
  type EntradaDeEdicaoDeAtendimento,
  type EntradaDeLote,
  type ResultadoEdicaoDeAtendimento,
  type ResultadoDoLote,
} from "./atendimentos";

const temBanco = Boolean(process.env.DATABASE_URL);

// Uma unica desconexao no fim do arquivo: os dois blocos abaixo compartilham o
// mesmo cliente, e desconectar dentro de um deles derrubaria a conexao debaixo
// do outro.
afterAll(async () => {
  await prisma.$disconnect();
}, 60_000);

/** Sufixo único para não colidir com paciente/terapia já existentes. */
const SUFIXO = Math.random().toString(36).slice(2, 10);

/** Data usada nos lançamentos. Não influencia saldo; só precisa ser válida. */
const DATA = "2026-01-15";

/**
 * `PrismaClient` é atribuível a `Prisma.TransactionClient` (que é só ele sem
 * `$transaction` e afins), então o mesmo tipo serve para os dois blocos: o de
 * regras passa o cliente da transação, o de concorrência passa o `prisma`.
 */
type ClienteDaTransacao = Parameters<
  Parameters<typeof prisma.$transaction>[0]
>[0];

/** Ids de tudo que foi criado, para o bloco sem rollback saber o que apagar. */
type Cenario = {
  pacienteId: number;
  requisicaoId: number;
  terapiaIds: number[];
  guiaIds: number[];
};

/**
 * Cria um paciente com uma requisição e uma guia por quantidade informada.
 *
 * Todas as guias ficam sob o **mesmo** paciente de propósito: é assim que o
 * formulário monta um lote, e é o que deixa os testes de lote com várias
 * terapias exercitarem a regra de saldo em vez de esbarrarem antes na checagem
 * de paciente.
 */
async function criarCenario(
  tx: ClienteDaTransacao,
  rotulo: string,
  qtdsAutorizadas: number[],
): Promise<Cenario> {
  const paciente = await tx.paciente.create({
    data: { nome: `Paciente Atendimento ${rotulo} ${SUFIXO}` },
  });

  const requisicao = await tx.requisicao.create({
    data: {
      numeroRequisicao: `ATD-${rotulo}-${SUFIXO}`,
      pacienteId: paciente.id,
    },
  });

  const terapiaIds: number[] = [];
  const guiaIds: number[] = [];

  for (const [indice, qtdAutorizada] of qtdsAutorizadas.entries()) {
    const terapia = await tx.terapia.create({
      data: {
        nome: `Terapia Atendimento ${rotulo} ${indice} ${SUFIXO}`,
        codigoTiss: `A${rotulo}${indice}`,
      },
    });

    const guia = await tx.requisicaoTerapia.create({
      data: {
        requisicaoId: requisicao.id,
        terapiaId: terapia.id,
        qtdAutorizada,
      },
    });

    terapiaIds.push(terapia.id);
    guiaIds.push(guia.id);
  }

  return {
    pacienteId: paciente.id,
    requisicaoId: requisicao.id,
    terapiaIds,
    guiaIds,
  };
}

/**
 * Apaga um cenário commitado. As guias levam os atendimentos junto (cascade).
 *
 * Cada DELETE é independente: um que falhe não pode impedir os seguintes de
 * rodarem, senão um tropeço no primeiro deixa o cenário inteiro no banco. Mas
 * tolerar a falha não é tolerar o silêncio — o que não for apagado sai no
 * `console.error` com o id da linha, porque este teste roda contra o banco de
 * produção e lixo esquecido lá só some se alguém enxergar qual é.
 *
 * A ordem é sequencial e não pode mudar: as FKs exigem apagar a guia antes da
 * requisição e da terapia, e a requisição antes do paciente.
 */
async function apagarCenario(cenario: Cenario): Promise<void> {
  const passos: { rotulo: string; apagar: () => Promise<unknown> }[] = [
    {
      rotulo: `requisicao_terapia id(s) ${cenario.guiaIds.join(", ")}`,
      apagar: () =>
        prisma.requisicaoTerapia.deleteMany({
          where: { id: { in: cenario.guiaIds } },
        }),
    },
    {
      rotulo: `requisicao id ${cenario.requisicaoId}`,
      apagar: () =>
        prisma.requisicao.deleteMany({ where: { id: cenario.requisicaoId } }),
    },
    {
      rotulo: `paciente id ${cenario.pacienteId}`,
      apagar: () =>
        prisma.paciente.deleteMany({ where: { id: cenario.pacienteId } }),
    },
    {
      rotulo: `terapia id(s) ${cenario.terapiaIds.join(", ")}`,
      apagar: () =>
        prisma.terapia.deleteMany({ where: { id: { in: cenario.terapiaIds } } }),
    },
  ];

  for (const passo of passos) {
    try {
      await passo.apagar();
    } catch (erro) {
      console.error(
        `[atendimentos.integration] limpeza NAO apagou ${passo.rotulo}; o dado continua no banco.`,
        erro,
      );
    }
  }
}

/** `qtd_utilizada` de uma guia, lida da view (a fonte de verdade). */
async function utilizadaNaView(
  tx: ClienteDaTransacao,
  guiaId: number,
): Promise<number> {
  const [linha] = await tx.$queryRaw<{ qtdUtilizada: number }[]>`
    SELECT "qtd_utilizada" AS "qtdUtilizada"
    FROM "requisicao_terapia_saldo"
    WHERE "id" = ${guiaId}
  `;

  return linha.qtdUtilizada;
}

// ---------------------------------------------------------------------------
// Regras que dependem do banco, com rollback
// ---------------------------------------------------------------------------

/** Erro sentinela: rola a transação de volta depois de coletar o resultado. */
class Rollback<T> extends Error {
  constructor(readonly dados: T) {
    super("rollback proposital do teste de integracao");
  }
}

/** Roda `executar` numa transação e desfaz tudo, devolvendo o que ela produziu. */
async function comRollback<T>(
  executar: (tx: ClienteDaTransacao) => Promise<T>,
): Promise<T> {
  try {
    await prisma.$transaction(
      async (tx) => {
        throw new Rollback(await executar(tx));
      },
      // `maxWait` é o tempo para *conseguir* a transação, e o padrão (2s) não
      // cobre a primeira, que ainda paga o custo de abrir a conexão contra o
      // banco remoto.
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

describe.skipIf(!temBanco)(
  "lancamento de atendimento contra o banco real",
  () => {
    it("lanca o lote inteiro e o saldo da view cai junto", async () => {
      const { resultado, utilizadas } = await comRollback(async (tx) => {
        const cenario = await criarCenario(tx, "OK", [10, 6]);

        const resultado = await lancarLoteNaTransacao(tx, {
          pacienteId: cenario.pacienteId,
          dataAtendimento: DATA,
          observacao: "  sessao dupla  ",
          itens: [
            { requisicaoTerapiaId: cenario.guiaIds[0], creditosConsumidos: 3 },
            { requisicaoTerapiaId: cenario.guiaIds[1], creditosConsumidos: 1 },
          ],
        });

        return {
          resultado,
          utilizadas: [
            await utilizadaNaView(tx, cenario.guiaIds[0]),
            await utilizadaNaView(tx, cenario.guiaIds[1]),
          ],
        };
      });

      expect(resultado).toEqual({
        ok: true,
        totalDeAtendimentos: 2,
        totalDeCreditos: 4,
      });
      expect(utilizadas).toEqual([3, 1]);
    });

    it("grava a observacao trimada, uma vez por atendimento do lote", async () => {
      const observacoes = await comRollback(async (tx) => {
        const cenario = await criarCenario(tx, "OBS", [5, 5]);

        await lancarLoteNaTransacao(tx, {
          pacienteId: cenario.pacienteId,
          dataAtendimento: DATA,
          observacao: "   faltou o responsavel   ",
          itens: cenario.guiaIds.map((guiaId) => ({
            requisicaoTerapiaId: guiaId,
            creditosConsumidos: 1,
          })),
        });

        const atendimentos = await tx.atendimento.findMany({
          where: { requisicaoTerapiaId: { in: cenario.guiaIds } },
          select: { observacao: true },
        });

        return atendimentos.map((atendimento) => atendimento.observacao);
      });

      expect(observacoes).toEqual([
        "faltou o responsavel",
        "faltou o responsavel",
      ]);
    });

    it("recusa creditos acima do saldo e nao grava nada do lote", async () => {
      const { resultado, atendimentos } = await comRollback(async (tx) => {
        // Primeira guia com saldo de sobra, segunda apertada: o erro precisa
        // apontar a segunda, e a primeira não pode sobrar gravada.
        const cenario = await criarCenario(tx, "SALDO", [10, 4]);

        const resultado = await lancarLoteNaTransacao(tx, {
          pacienteId: cenario.pacienteId,
          dataAtendimento: DATA,
          observacao: null,
          itens: [
            { requisicaoTerapiaId: cenario.guiaIds[0], creditosConsumidos: 1 },
            { requisicaoTerapiaId: cenario.guiaIds[1], creditosConsumidos: 5 },
          ],
        });

        const atendimentos = await tx.atendimento.count({
          where: { requisicaoTerapiaId: { in: cenario.guiaIds } },
        });

        return { resultado, atendimentos };
      });

      expect(resultado).toMatchObject({ ok: false, item: 1 });
      // A mensagem diz o saldo real (4) e o que foi pedido (5).
      expect(resultado.ok === false && resultado.erro).toContain("4");
      expect(resultado.ok === false && resultado.erro).toContain("5");
      expect(atendimentos).toBe(0);
    });

    it("recusa guia sem saldo nenhum", async () => {
      const resultado = await comRollback(async (tx) => {
        const cenario = await criarCenario(tx, "ZERADA", [2]);

        await tx.atendimento.create({
          data: {
            requisicaoTerapiaId: cenario.guiaIds[0],
            dataAtendimento: new Date(`${DATA}T00:00:00.000Z`),
            creditosConsumidos: 2,
          },
        });

        return lancarLoteNaTransacao(tx, {
          pacienteId: cenario.pacienteId,
          dataAtendimento: DATA,
          observacao: null,
          itens: [
            { requisicaoTerapiaId: cenario.guiaIds[0], creditosConsumidos: 1 },
          ],
        });
      });

      expect(resultado).toMatchObject({ ok: false, item: 0 });
      expect(resultado.ok === false && resultado.erro).toContain(
        "não tem mais saldo",
      );
    });

    it("recusa guia inexistente", async () => {
      const resultado = await comRollback(async (tx) => {
        const cenario = await criarCenario(tx, "FANTASMA", [10]);

        // A guia foi apagada entre a página carregar e o lote ser enviado.
        await tx.requisicaoTerapia.delete({ where: { id: cenario.guiaIds[0] } });

        return lancarLoteNaTransacao(tx, {
          pacienteId: cenario.pacienteId,
          dataAtendimento: DATA,
          observacao: null,
          itens: [
            { requisicaoTerapiaId: cenario.guiaIds[0], creditosConsumidos: 1 },
          ],
        });
      });

      expect(resultado).toEqual({
        ok: false,
        erro: ERRO_GUIA_INEXISTENTE,
        item: 0,
      });
    });

    it("recusa guia que nao e do paciente do lote", async () => {
      const resultado = await comRollback(async (tx) => {
        const doLote = await criarCenario(tx, "DONO", [10]);
        const deOutro = await criarCenario(tx, "ALHEIA", [10]);

        return lancarLoteNaTransacao(tx, {
          pacienteId: doLote.pacienteId,
          dataAtendimento: DATA,
          observacao: null,
          itens: [
            { requisicaoTerapiaId: deOutro.guiaIds[0], creditosConsumidos: 1 },
          ],
        });
      });

      expect(resultado).toEqual({
        ok: false,
        erro: ERRO_GUIA_DE_OUTRO_PACIENTE,
        item: 0,
      });
    });

    it("some da lista de guias disponiveis quando o saldo zera (regra 6)", async () => {
      const { antes, depois } = await comRollback(async (tx) => {
        const cenario = await criarCenario(tx, "REGRA6", [2]);

        // `listarGuiasDisponiveisDoPaciente` usa o `prisma` global, que está
        // fora desta transação e não enxergaria dados ainda não commitados —
        // por isso o filtro da regra 6 é refeito aqui com o cliente da
        // transação.
        const contar = async () => {
          const linhas = await tx.$queryRaw<{ id: number }[]>`
            SELECT s."id"
            FROM "requisicao_terapia_saldo" s
            JOIN "requisicao" r ON r."id" = s."requisicao_id"
            WHERE r."paciente_id" = ${cenario.pacienteId}
              AND s."saldo_restante" > 0
          `;

          return linhas.length;
        };

        const antes = await contar();

        await lancarLoteNaTransacao(tx, {
          pacienteId: cenario.pacienteId,
          dataAtendimento: DATA,
          observacao: null,
          itens: [
            { requisicaoTerapiaId: cenario.guiaIds[0], creditosConsumidos: 2 },
          ],
        });

        return { antes, depois: await contar() };
      });

      expect(antes).toBe(1);
      expect(depois).toBe(0);
    });

    it("nao devolve guia para paciente inexistente", async () => {
      expect(await listarGuiasDisponiveisDoPaciente(-1)).toEqual([]);
    });

    it("aceita editar atendimento para zero créditos e atualiza o saldo da view", async () => {
      const resultado = await comRollback(async (tx) => {
        const cenario = await criarCenario(tx, "EDZERO", [3]);
        const primeiro = await tx.atendimento.create({
          data: {
            requisicaoTerapiaId: cenario.guiaIds[0],
            dataAtendimento: new Date(`${DATA}T00:00:00.000Z`),
            creditosConsumidos: 2,
            observacao: "antes",
          },
        });

        await tx.atendimento.create({
          data: {
            requisicaoTerapiaId: cenario.guiaIds[0],
            dataAtendimento: new Date(`${DATA}T00:00:00.000Z`),
            creditosConsumidos: 1,
          },
        });

        const edicao = await editarAtendimentoNaTransacao(tx, {
          atendimentoId: primeiro.id,
          dataAtendimento: "2026-01-16",
          creditosConsumidos: 0,
          observacao: "  zerado manualmente  ",
        });

        const salvo = await tx.atendimento.findUniqueOrThrow({
          where: { id: primeiro.id },
          select: {
            dataAtendimento: true,
            creditosConsumidos: true,
            observacao: true,
          },
        });

        return {
          edicao,
          salvo: {
            ...salvo,
            dataAtendimento: salvo.dataAtendimento.toISOString().slice(0, 10),
          },
          utilizada: await utilizadaNaView(tx, cenario.guiaIds[0]),
        };
      });

      expect(resultado.edicao).toMatchObject({
        ok: true,
        totalUtilizado: 1,
      });
      expect(resultado.salvo).toEqual({
        dataAtendimento: "2026-01-16",
        creditosConsumidos: 0,
        observacao: "zerado manualmente",
      });
      expect(resultado.utilizada).toBe(1);
    });

    it("recusa editar atendimento para crédito negativo e mantém a linha", async () => {
      const resultado = await comRollback(async (tx) => {
        const cenario = await criarCenario(tx, "EDNEG", [4]);
        const atendimento = await tx.atendimento.create({
          data: {
            requisicaoTerapiaId: cenario.guiaIds[0],
            dataAtendimento: new Date(`${DATA}T00:00:00.000Z`),
            creditosConsumidos: 1,
          },
        });

        const edicao = await editarAtendimentoNaTransacao(tx, {
          atendimentoId: atendimento.id,
          dataAtendimento: DATA,
          creditosConsumidos: -1,
          observacao: null,
        });

        const salvo = await tx.atendimento.findUniqueOrThrow({
          where: { id: atendimento.id },
          select: { creditosConsumidos: true },
        });

        return { edicao, salvo };
      });

      expect(resultado.edicao).toEqual({
        ok: false,
        erro: ERRO_CREDITOS_EDICAO_INVALIDOS,
      });
      expect(resultado.salvo.creditosConsumidos).toBe(1);
    });

    it("recusa edição que faria o total passar da quantidade autorizada", async () => {
      const resultado = await comRollback(async (tx) => {
        const cenario = await criarCenario(tx, "EDEXCEDE", [5]);
        const primeiro = await tx.atendimento.create({
          data: {
            requisicaoTerapiaId: cenario.guiaIds[0],
            dataAtendimento: new Date(`${DATA}T00:00:00.000Z`),
            creditosConsumidos: 2,
          },
        });

        await tx.atendimento.create({
          data: {
            requisicaoTerapiaId: cenario.guiaIds[0],
            dataAtendimento: new Date(`${DATA}T00:00:00.000Z`),
            creditosConsumidos: 2,
          },
        });

        const edicao = await editarAtendimentoNaTransacao(tx, {
          atendimentoId: primeiro.id,
          dataAtendimento: DATA,
          creditosConsumidos: 4,
          observacao: null,
        });

        const salvo = await tx.atendimento.findUniqueOrThrow({
          where: { id: primeiro.id },
          select: { creditosConsumidos: true },
        });

        return {
          edicao,
          salvo,
          utilizada: await utilizadaNaView(tx, cenario.guiaIds[0]),
        };
      });

      expect(resultado.edicao.ok).toBe(false);
      expect(resultado.edicao.ok === false && resultado.edicao.erro).toContain(
        "5",
      );
      expect(resultado.edicao.ok === false && resultado.edicao.erro).toContain(
        "2",
      );
      expect(resultado.edicao.ok === false && resultado.edicao.erro).toContain(
        "4",
      );
      expect(resultado.salvo.creditosConsumidos).toBe(2);
      expect(resultado.utilizada).toBe(4);
    });

    it("exclui atendimento e atualiza o saldo da view", async () => {
      const resultado = await comRollback(async (tx) => {
        const cenario = await criarCenario(tx, "EXCATD", [5]);
        const atendimento = await tx.atendimento.create({
          data: {
            requisicaoTerapiaId: cenario.guiaIds[0],
            dataAtendimento: new Date(`${DATA}T00:00:00.000Z`),
            creditosConsumidos: 2,
          },
        });

        const antes = await utilizadaNaView(tx, cenario.guiaIds[0]);
        const exclusao = await excluirAtendimentoNaTransacao(tx, atendimento.id);
        const depois = await utilizadaNaView(tx, cenario.guiaIds[0]);

        return { antes, exclusao, depois };
      });

      expect(resultado.antes).toBe(2);
      expect(resultado.exclusao).toEqual({ ok: true });
      expect(resultado.depois).toBe(0);
    });

    it("devolve erro amigável ao excluir atendimento inexistente", async () => {
      const resultado = await excluirAtendimentoPeloId(-1);

      expect(resultado).toEqual({
        ok: false,
        erro: ERRO_ATENDIMENTO_ID_INVALIDO,
      });

      const inexistente = await excluirAtendimentoPeloId(2_147_483_647);

      expect(inexistente).toEqual({
        ok: false,
        erro: ERRO_ATENDIMENTO_INEXISTENTE,
      });
    });
  },
);

// ---------------------------------------------------------------------------
// Corrida de saldo (item 5 do Prompt 6)
// ---------------------------------------------------------------------------

/** Um portão que o teste abre quando quer deixar a transação A commitar. */
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

/** Espera `condicao` virar true, com teto. Devolve se conseguiu. */
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
 * `true` quando existe outra conexão nossa parada esperando um lock.
 *
 * É o que transforma "esperei um pouco e deu certo" em prova de que a segunda
 * transação **bloqueou** no `FOR UPDATE`. Todas as conexões do teste usam o
 * mesmo role, então o `pg_stat_activity` mostra as linhas delas por inteiro
 * mesmo sem privilégio de superusuário.
 */
async function existeConexaoBloqueada(): Promise<boolean> {
  const [linha] = await prisma.$queryRaw<{ total: bigint }[]>`
    SELECT count(*) AS "total"
    FROM pg_stat_activity
    WHERE "datname" = current_database()
      AND "pid" <> pg_backend_pid()
      AND "wait_event_type" = 'Lock'
  `;

  return Number(linha.total) > 0;
}

/**
 * Abre `conexoes` conexões ao mesmo tempo e devolve todas ao pool.
 *
 * Contra um Postgres remoto atrás de um pooler, abrir uma conexão nova custa
 * ~2,4s, e a transação B é a função de **produção** (`lancarLote` /
 * `editarAtendimentoPeloId`). Foi essa medição que revelou que o `maxWait`
 * padrão do Prisma (2s) é curto demais até sem concorrência nenhuma: B morria
 * com `P2028` **antes** de chegar ao `SELECT ... FOR UPDATE`, nenhuma conexão
 * aparecia esperando lock e o teste acusava "não bloqueou" sem ter chegado a
 * exercitar o lock. Hoje a produção leva `maxWait` explícito
 * (`OPCOES_DE_TRANSACAO`, em `lib/db/transacao.ts`), então B não perde mais
 * essa corrida; aquecer continua valendo porque tira a latência de conexão do
 * relógio de B, e o que o teste mede volta a ser só o lock.
 *
 * O `pg_sleep` é o que força conexões *distintas*: sem ele o pool atenderia as
 * consultas em sequência com uma só. O `::text` existe porque `pg_sleep`
 * devolve `void`, que o Prisma não sabe desserializar em `$queryRaw`.
 */
async function aquecerPool(conexoes = 4): Promise<void> {
  await Promise.all(
    Array.from(
      { length: conexoes },
      () => prisma.$queryRaw`SELECT pg_sleep(0.2)::text AS "ok"`,
    ),
  );
}

describe.skipIf(!temBanco)("corrida de saldo entre dois lancamentos", () => {
  let criado: Cenario | null = null;

  afterAll(async () => {
    // Este bloco commita de verdade (é o ponto do teste), então a limpeza é
    // manual — não há transação para desfazer.
    if (criado) {
      await apagarCenario(criado);
    }
    // Timeout explícito: o padrão do Vitest é curto demais para quatro DELETEs
    // contra um banco remoto. É só rede de segurança — o que garante que os
    // DELETEs não fiquem presos num lock é o `finally` do teste, que sempre
    // encerra a transação A.
  }, 60_000);

  it("com saldo para so um dos dois lotes, apenas um e aceito", async () => {
    // Guia de 3 créditos; cada lote pede 2. Cabem separados, não cabem juntos.
    const cenario = await criarCenario(prisma, "CORRIDA", [3]);
    criado = cenario;

    const lote: EntradaDeLote = {
      pacienteId: cenario.pacienteId,
      dataAtendimento: DATA,
      observacao: null,
      itens: [{ requisicaoTerapiaId: cenario.guiaIds[0], creditosConsumidos: 2 }],
    };

    // Antes de A tomar uma conexão: ver comentário de `aquecerPool`.
    await aquecerPool();

    const portao = criarPortao();
    let resultadoA: ResultadoDoLote | null = null;

    // Transação A: trava a guia, lê o saldo, insere — e fica parada no portão,
    // segurando o lock com a transação ainda aberta.
    const transacaoA = prisma.$transaction(
      async (tx) => {
        resultadoA = await lancarLoteNaTransacao(tx, lote);
        await portao.promessa;

        return resultadoA;
      },
      { maxWait: 30_000, timeout: 30_000 },
    );

    // Tudo daqui em diante fica no `try`: o portão **precisa** ser aberto e a
    // transação A **precisa** terminar (commit ou rollback) mesmo que uma
    // asserção falhe no meio. Sem isso, uma falha antes do `portao.abrir()`
    // deixa A segurando o lock da guia até o timeout de 30s, o `afterAll` trava
    // nos DELETEs esperando esse mesmo lock e o cenário commitado fica órfão.
    const pendentes: Promise<unknown>[] = [transacaoA];

    try {
      const aChegouNoPortao = await esperarAte(
        () => resultadoA !== null,
        10_000,
      );
      expect(aChegouNoPortao).toBe(true);

      // Transação B: abre agora, com A ainda sem commitar. O `FOR UPDATE` dela
      // vai bater no lock de A. É a função de produção (`lancarLote`, que abre
      // a própria transação), não uma versão de teste.
      const transacaoB = lancarLote(lote);
      pendentes.push(transacaoB);

      // Janela curta de propósito: `lancarLote` usa o timeout padrão do Prisma
      // para a transação (5s), e B passa esse tempo bloqueada. Detectar o
      // bloqueio leva milissegundos; esperar demais aqui faria B estourar o
      // timeout em vez de ser recusada pelo saldo.
      const bBloqueou = await esperarAte(existeConexaoBloqueada, 2_000);
      expect(bBloqueou).toBe(true);

      portao.abrir();

      const [a, b] = await Promise.all([transacaoA, transacaoB]);

      // Exatamente uma das duas passou.
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);

      // A é a que passa: ela chegou primeiro ao lock.
      expect(a).toEqual({
        ok: true,
        totalDeAtendimentos: 1,
        totalDeCreditos: 2,
      });

      // B foi recusada pelo saldo (1 restante contra 2 pedidos), não por outro
      // motivo qualquer — é isso que mostra que ela releu a view depois do
      // commit de A, em vez de decidir com o snapshot velho (que diria 3).
      expect(b.ok).toBe(false);
      expect(b.ok === false && b.erro).toContain("1");
      expect(b.ok === false && b.erro).toContain("2");

      // O que o lock existe para impedir: 2 + 2 = 4 numa guia de 3.
      expect(await utilizadaNaView(prisma, cenario.guiaIds[0])).toBe(2);
      expect(
        await prisma.atendimento.count({
          where: { requisicaoTerapiaId: cenario.guiaIds[0] },
        }),
      ).toBe(1);
    } finally {
      // Idempotente: abrir um portão já aberto não faz nada. `allSettled`
      // porque no caminho de falha estas promessas rejeitam, e o erro que
      // importa é o da asserção, não o da transação abortada.
      portao.abrir();
      await Promise.allSettled(pendentes);
    }
  }, 60_000);
});

describe.skipIf(!temBanco)("corrida de saldo entre duas edições", () => {
  let criado: Cenario | null = null;

  afterAll(async () => {
    if (criado) {
      await apagarCenario(criado);
    }
  }, 60_000);

  it("com autorização para só uma edição, apenas uma é aceita", async () => {
    // Guia de 5 créditos, com dois atendimentos de 1. Cada edição para 3 cabe
    // separadamente (3 + 1 = 4), mas as duas juntas passariam para 6.
    const cenario = await criarCenario(prisma, "CORRIDAED", [5]);
    criado = cenario;

    const primeiro = await prisma.atendimento.create({
      data: {
        requisicaoTerapiaId: cenario.guiaIds[0],
        dataAtendimento: new Date(`${DATA}T00:00:00.000Z`),
        creditosConsumidos: 1,
      },
    });

    const segundo = await prisma.atendimento.create({
      data: {
        requisicaoTerapiaId: cenario.guiaIds[0],
        dataAtendimento: new Date(`${DATA}T00:00:00.000Z`),
        creditosConsumidos: 1,
      },
    });

    const edicaoA: EntradaDeEdicaoDeAtendimento = {
      atendimentoId: primeiro.id,
      dataAtendimento: DATA,
      creditosConsumidos: 3,
      observacao: null,
    };

    const edicaoB: EntradaDeEdicaoDeAtendimento = {
      atendimentoId: segundo.id,
      dataAtendimento: DATA,
      creditosConsumidos: 3,
      observacao: null,
    };

    await aquecerPool();

    const portao = criarPortao();
    let resultadoA: ResultadoEdicaoDeAtendimento | null = null;

    // A trava a guia, recalcula, atualiza e fica parada antes do commit,
    // segurando a mesma linha de `requisicao_terapia` que B precisa travar.
    const transacaoA = prisma.$transaction(
      async (tx) => {
        resultadoA = await editarAtendimentoNaTransacao(tx, edicaoA);
        await portao.promessa;

        return resultadoA;
      },
      { maxWait: 30_000, timeout: 30_000 },
    );

    // Mesmo motivo do bloco de lançamento: o `finally` garante que A termine
    // mesmo se uma asserção falhar antes do `portao.abrir()`, senão o lock fica
    // de pé até os 30s e o `afterAll` não consegue apagar o cenário.
    const pendentes: Promise<unknown>[] = [transacaoA];

    try {
      const aChegouNoPortao = await esperarAte(
        () => resultadoA !== null,
        10_000,
      );
      expect(aChegouNoPortao).toBe(true);

      // B usa a função de produção, que abre a própria transação. Com A ainda
      // sem commitar, B deve bloquear no `FOR UPDATE` da guia.
      const transacaoB = editarAtendimentoPeloId(edicaoB);
      pendentes.push(transacaoB);

      const bBloqueou = await esperarAte(existeConexaoBloqueada, 2_000);
      expect(bBloqueou).toBe(true);

      portao.abrir();

      const [a, b] = await Promise.all([transacaoA, transacaoB]);

      expect(a).toEqual({
        ok: true,
        requisicaoTerapiaId: cenario.guiaIds[0],
        totalUtilizado: 4,
      });

      expect(b.ok).toBe(false);
      expect(b.ok === false && b.erro).toContain("5");
      expect(b.ok === false && b.erro).toContain("3");

      expect(await utilizadaNaView(prisma, cenario.guiaIds[0])).toBe(4);

      const creditos = await prisma.atendimento.findMany({
        where: { requisicaoTerapiaId: cenario.guiaIds[0] },
        orderBy: { id: "asc" },
        select: { creditosConsumidos: true },
      });

      expect(
        creditos.map((atendimento) => atendimento.creditosConsumidos),
      ).toEqual([3, 1]);
    } finally {
      portao.abrir();
      await Promise.allSettled(pendentes);
    }
  }, 60_000);
});

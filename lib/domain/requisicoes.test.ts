/**
 * Cadastro de requisição com o banco dublado.
 *
 * O que está sob teste é a decisão do nosso código: quando reaproveitar um
 * paciente, quando recusar um número repetido, e — o ponto principal — que a
 * falha de uma linha de terapia **lança** de dentro da transação, em vez de
 * devolver `{ ok: false }` educadamente. Devolver seria pior do que parece: o
 * paciente recém-criado ficaria no banco, órfão, porque nada teria mandado o
 * Postgres desfazer.
 *
 * O SQL propriamente dito (o `ON CONFLICT (lower(nome))`, a unique do número)
 * é problema de `requisicoes.integration.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  /** O "banco". Cada teste ajusta antes de chamar a action. */
  const banco = {
    /** Paciente devolvido pelo get-or-create. */
    paciente: { id: 10, nome: "José Silva", criado: true },
    /** `true` quando já existe requisição com o número pedido. */
    numeroJaExiste: false,
    /** Ids de terapia que existem no banco. */
    terapiasExistentes: [1, 2],
  };

  /** Registro do que a transação chegou a escrever antes de falhar. */
  const escritas: string[] = [];

  const criarRequisicao = vi.fn(async () => {
    escritas.push("requisicao");
    return { id: 99 };
  });

  const buscarRequisicao = vi.fn(async () =>
    banco.numeroJaExiste ? { id: 42 } : null,
  );

  const buscarTerapias = vi.fn(async (args: { where: { id: { in: number[] } } }) =>
    args.where.id.in
      .filter((id) => banco.terapiasExistentes.includes(id))
      .map((id) => ({ id })),
  );

  /**
   * O get-or-create do paciente é a única consulta crua da função.
   *
   * `valores` são os parâmetros interpolados no template — é por eles que os
   * testes conferem que o nome chegou trimado.
   */
  const consultar = vi.fn(async (
    partes: TemplateStringsArray,
    ...valores: unknown[]
  ) => {
    void valores;

    const sql = partes.join(" ");

    if (sql.includes("ON CONFLICT")) {
      escritas.push("paciente");
      return [banco.paciente];
    }

    throw new Error(`consulta nao prevista pelo teste: ${sql}`);
  });

  /**
   * Simula a atomicidade: se o callback lançar, o que foi escrito é descartado
   * — que é exatamente o que o Postgres faz no rollback.
   */
  const transacao = vi.fn(async (executar: (tx: unknown) => Promise<unknown>) => {
    try {
      return await executar({
        $queryRaw: consultar,
        requisicao: { findFirst: buscarRequisicao, create: criarRequisicao },
        terapia: { findMany: buscarTerapias },
      });
    } catch (erro) {
      escritas.length = 0;
      throw erro;
    }
  });

  const requireUsuario = vi.fn(async () => ({ id: 1, username: "admin" }));

  const refresh = vi.fn();

  return {
    banco,
    buscarRequisicao,
    buscarTerapias,
    consultar,
    criarRequisicao,
    escritas,
    refresh,
    requireUsuario,
    transacao,
  };
});

vi.mock("@/lib/db", () => ({
  getPrismaClient: () => ({ $transaction: mocks.transacao }),
}));

vi.mock("@/lib/auth/current-user", () => ({
  requireUsuario: mocks.requireUsuario,
}));

vi.mock("next/cache", () => ({ refresh: mocks.refresh }));

import {
  criarRequisicao,
  ERRO_NUMERO_OBRIGATORIO,
  ERRO_PACIENTE_OBRIGATORIO,
  ERRO_QTD_INVALIDA,
  ERRO_SEM_TERAPIA,
  ERRO_TERAPIA_INEXISTENTE,
  ERRO_TERAPIA_OBRIGATORIA,
  ERRO_VALIDADE_INVALIDA,
  erroNumeroDuplicado,
  type EntradaNovaRequisicao,
} from "./requisicoes";
import { criarRequisicaoAction } from "./requisicoes-actions";

/** Entrada válida; cada teste muda só o que lhe interessa. */
function entrada(
  ajustes: Partial<EntradaNovaRequisicao> = {},
): EntradaNovaRequisicao {
  return {
    pacienteNome: "José Silva",
    numeroRequisicao: "2026-001",
    linhas: [{ terapiaId: 1, qtdAutorizada: 10, validade: null }],
    ...ajustes,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.banco.paciente = { id: 10, nome: "José Silva", criado: true };
  mocks.banco.numeroJaExiste = false;
  mocks.banco.terapiasExistentes = [1, 2];
  mocks.escritas.length = 0;
});

describe("criarRequisicao — paciente novo vs. existente", () => {
  it("cria a requisição em um paciente novo", async () => {
    mocks.banco.paciente = { id: 10, nome: "José Silva", criado: true };

    const resultado = await criarRequisicao(entrada());

    expect(resultado).toEqual({
      ok: true,
      requisicaoId: 99,
      numeroRequisicao: "2026-001",
      pacienteNome: "José Silva",
      pacienteCriado: true,
    });
  });

  it("reaproveita o paciente existente em vez de criar outro", async () => {
    // O `ON CONFLICT ... DO NOTHING` não inseriu: o nome já estava lá, com
    // outra caixa.
    mocks.banco.paciente = { id: 7, nome: "José Silva", criado: false };

    const resultado = await criarRequisicao(
      entrada({ pacienteNome: "JOSÉ SILVA" }),
    );

    expect(resultado).toMatchObject({ ok: true, pacienteCriado: false });
    // O nome devolvido é o que já estava no banco, não o que foi digitado —
    // é ele que o dashboard mostra.
    expect(resultado).toMatchObject({ pacienteNome: "José Silva" });
    expect(mocks.criarRequisicao).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pacienteId: 7 }),
      }),
    );
  });

  it("trima o nome do paciente e o número antes de gravar", async () => {
    await criarRequisicao(
      entrada({
        pacienteNome: "  José Silva  ",
        numeroRequisicao: "  2026-001  ",
      }),
    );

    // O nome trimado é o que vai para o get-or-create; sem isso "José Silva "
    // e "José Silva" virariam dois pacientes, e o índice `lower(nome)` não
    // pegaria a diferença (o espaço não é caixa).
    const [, nome] = mocks.consultar.mock.calls[0];
    expect(nome).toBe("José Silva");

    expect(mocks.criarRequisicao).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ numeroRequisicao: "2026-001" }),
      }),
    );
  });
});

describe("criarRequisicao — número de requisição duplicado", () => {
  it("recusa o número já usado pelo mesmo paciente", async () => {
    mocks.banco.numeroJaExiste = true;

    const resultado = await criarRequisicao(entrada());

    expect(resultado).toEqual({
      ok: false,
      erro: erroNumeroDuplicado("2026-001", "José Silva"),
      linha: undefined,
    });
    expect(mocks.criarRequisicao).not.toHaveBeenCalled();
  });

  it("não deixa paciente órfão quando o número é duplicado", async () => {
    mocks.banco.numeroJaExiste = true;

    await criarRequisicao(entrada());

    // O paciente chegou a ser criado antes da checagem do número; o rollback
    // é o que impede que ele fique no banco sem requisição nenhuma.
    expect(mocks.escritas).toEqual([]);
  });

  it("procura o número dentro do paciente, não no sistema inteiro", async () => {
    await criarRequisicao(entrada());

    // A unicidade é por paciente (CONTEXT.md): sem o `pacienteId` no filtro, o
    // mesmo número em outro paciente seria recusado por engano.
    expect(mocks.buscarRequisicao).toHaveBeenCalledWith({
      where: { pacienteId: 10, numeroRequisicao: "2026-001" },
      select: { id: true },
    });
  });

  it("traduz a unique do banco quando a pré-checagem perde a corrida", async () => {
    // A pré-checagem não viu nada, mas outro cadastro entrou no meio e a
    // unique do banco estourou.
    mocks.transacao.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        meta: { target: "requisicao_paciente_id_numero_requisicao_key" },
      }),
    );

    const resultado = await criarRequisicao(entrada());

    expect(resultado).toEqual({
      ok: false,
      erro: erroNumeroDuplicado("2026-001", "José Silva"),
    });
  });

  it("deixa passar erro de banco que não seja a unique do número", async () => {
    mocks.transacao.mockRejectedValueOnce(new Error("conexao caiu"));

    await expect(criarRequisicao(entrada())).rejects.toThrow("conexao caiu");
  });
});

describe("criarRequisicao — rollback quando uma linha falha", () => {
  it("desfaz tudo se uma terapia da lista não existe", async () => {
    mocks.banco.terapiasExistentes = [1];

    const resultado = await criarRequisicao(
      entrada({
        linhas: [
          { terapiaId: 1, qtdAutorizada: 10, validade: null },
          // Só descoberta contra o banco, depois de o paciente já ter sido
          // criado: é o caso que exige rollback de verdade.
          { terapiaId: 404, qtdAutorizada: 4, validade: null },
        ],
      }),
    );

    expect(resultado).toEqual({
      ok: false,
      erro: ERRO_TERAPIA_INEXISTENTE,
      linha: 1,
    });
    expect(mocks.criarRequisicao).not.toHaveBeenCalled();
    // Nenhum paciente órfão: a escrita do paciente foi descartada junto.
    expect(mocks.escritas).toEqual([]);
  });

  it("aponta a primeira linha ruim, não a última", async () => {
    mocks.banco.terapiasExistentes = [2];

    const resultado = await criarRequisicao(
      entrada({
        linhas: [
          { terapiaId: 404, qtdAutorizada: 1, validade: null },
          { terapiaId: 2, qtdAutorizada: 1, validade: null },
          { terapiaId: 405, qtdAutorizada: 1, validade: null },
        ],
      }),
    );

    expect(resultado).toMatchObject({ ok: false, linha: 0 });
  });

  it("nem abre transação quando a validação sem banco já reprova", async () => {
    const resultado = await criarRequisicao(
      entrada({ linhas: [{ terapiaId: 1, qtdAutorizada: 0, validade: null }] }),
    );

    expect(resultado).toEqual({ ok: false, erro: ERRO_QTD_INVALIDA, linha: 0 });
    expect(mocks.transacao).not.toHaveBeenCalled();
  });
});

describe("criarRequisicao — validação de entrada", () => {
  it.each([
    ["nome do paciente vazio", { pacienteNome: "   " }, ERRO_PACIENTE_OBRIGATORIO],
    ["número vazio", { numeroRequisicao: "  " }, ERRO_NUMERO_OBRIGATORIO],
    ["nenhuma terapia", { linhas: [] }, ERRO_SEM_TERAPIA],
  ])("recusa %s", async (_rotulo, ajustes, mensagem) => {
    const resultado = await criarRequisicao(entrada(ajustes));

    expect(resultado).toMatchObject({ ok: false, erro: mensagem });
    expect(mocks.transacao).not.toHaveBeenCalled();
  });

  it.each([0, -3, 1.5, Number.NaN])(
    "recusa a quantidade autorizada %p",
    async (quantidade) => {
      const resultado = await criarRequisicao(
        entrada({
          linhas: [
            { terapiaId: 1, qtdAutorizada: quantidade, validade: null },
          ],
        }),
      );

      expect(resultado).toEqual({
        ok: false,
        erro: ERRO_QTD_INVALIDA,
        linha: 0,
      });
    },
  );

  it.each([0, -1, 1.5, Number.NaN])(
    "recusa o id de terapia %p",
    async (terapiaId) => {
      const resultado = await criarRequisicao(
        entrada({
          linhas: [{ terapiaId, qtdAutorizada: 5, validade: null }],
        }),
      );

      expect(resultado).toEqual({
        ok: false,
        erro: ERRO_TERAPIA_OBRIGATORIA,
        linha: 0,
      });
    },
  );

  it.each(["31/12/2026", "2026-13-01", "2026-02-31", "2026-2-1", "amanhã"])(
    "recusa a validade %p",
    async (validade) => {
      const resultado = await criarRequisicao(
        entrada({
          linhas: [{ terapiaId: 1, qtdAutorizada: 5, validade }],
        }),
      );

      expect(resultado).toEqual({
        ok: false,
        erro: ERRO_VALIDADE_INVALIDA,
        linha: 0,
      });
    },
  );

  it("aceita validade ausente e validade real", async () => {
    const resultado = await criarRequisicao(
      entrada({
        linhas: [
          { terapiaId: 1, qtdAutorizada: 5, validade: null },
          { terapiaId: 2, qtdAutorizada: 8, validade: "2028-02-29" },
        ],
      }),
    );

    expect(resultado).toMatchObject({ ok: true });
    expect(mocks.criarRequisicao).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          guias: {
            create: [
              { terapiaId: 1, qtdAutorizada: 5, validade: null },
              {
                terapiaId: 2,
                qtdAutorizada: 8,
                // Meia-noite UTC: o dia gravado não pode depender do fuso de
                // quem submeteu o formulário.
                validade: new Date("2028-02-29T00:00:00.000Z"),
              },
            ],
          },
        }),
      }),
    );
  });
});

describe("criarRequisicaoAction (Server Action)", () => {
  /** Monta o FormData como o formulário monta: campos repetidos por linha. */
  function formulario(
    campos: {
      pacienteNome?: string;
      numeroRequisicao?: string;
      linhas?: { terapiaId: string; qtdAutorizada: string; validade: string }[];
    } = {},
  ): FormData {
    const formData = new FormData();

    formData.set("pacienteNome", campos.pacienteNome ?? "José Silva");
    formData.set("numeroRequisicao", campos.numeroRequisicao ?? "2026-001");

    const linhas = campos.linhas ?? [
      { terapiaId: "1", qtdAutorizada: "10", validade: "" },
    ];

    for (const linha of linhas) {
      formData.append("terapiaId", linha.terapiaId);
      formData.append("qtdAutorizada", linha.qtdAutorizada);
      formData.append("validade", linha.validade);
    }

    return formData;
  }

  it("exige usuário autenticado antes de tocar no banco", async () => {
    mocks.requireUsuario.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

    await expect(criarRequisicaoAction({}, formulario())).rejects.toThrow(
      "NEXT_REDIRECT",
    );

    expect(mocks.transacao).not.toHaveBeenCalled();
  });

  it("permanece na tela, atualiza a rota atual e devolve sucesso com token", async () => {
    const estado = await criarRequisicaoAction({}, formulario());

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(estado).toEqual({
      sucesso: {
        pacienteNome: "José Silva",
        numeroRequisicao: "2026-001",
        token: expect.any(String),
      },
    });
  });

  it("gera um token diferente para cada sucesso", async () => {
    const primeiro = await criarRequisicaoAction({}, formulario());
    const segundo = await criarRequisicaoAction(
      {},
      formulario({ numeroRequisicao: "2026-002" }),
    );

    expect(primeiro.sucesso?.token).toEqual(expect.any(String));
    expect(segundo.sucesso?.token).toEqual(expect.any(String));
    expect(segundo.sucesso?.token).not.toBe(primeiro.sucesso?.token);
  });

  it("devolve o erro para o formulário em vez de sinalizar sucesso", async () => {
    mocks.banco.numeroJaExiste = true;

    const estado = await criarRequisicaoAction({}, formulario());

    expect(estado).toEqual({
      erro: erroNumeroDuplicado("2026-001", "José Silva"),
      linha: undefined,
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("costura as linhas repetidas do formulário na ordem do DOM", async () => {
    const estado = await criarRequisicaoAction(
      {},
      formulario({
        linhas: [
          { terapiaId: "1", qtdAutorizada: "10", validade: "2026-03-01" },
          { terapiaId: "2", qtdAutorizada: "4", validade: "" },
        ],
      }),
    );

    expect(estado.sucesso?.token).toEqual(expect.any(String));
    expect(mocks.criarRequisicao).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          guias: {
            create: [
              {
                terapiaId: 1,
                qtdAutorizada: 10,
                validade: new Date("2026-03-01T00:00:00.000Z"),
              },
              // Validade vazia é ausência de validade, não erro.
              { terapiaId: 2, qtdAutorizada: 4, validade: null },
            ],
          },
        }),
      }),
    );
  });

  it.each(["", "  ", "3.7", "1e3", "10abc"])(
    "recusa a quantidade %p vinda do formulário como texto",
    async (quantidade) => {
      const estado = await criarRequisicaoAction(
        {},
        formulario({
          linhas: [
            { terapiaId: "1", qtdAutorizada: quantidade, validade: "" },
          ],
        }),
      );

      // `Number("")` é 0 e `Number("1e3")` é 1000: converter com `Number` cru
      // deixaria passar quantidade que o usuário nunca digitou.
      expect(estado).toEqual({ erro: ERRO_QTD_INVALIDA, linha: 0 });
    },
  );

  it("recusa o POST sem nenhuma linha de terapia", async () => {
    // A UI garante uma linha; um POST direto, não.
    const estado = await criarRequisicaoAction({}, formulario({ linhas: [] }));

    expect(estado).toEqual({ erro: ERRO_SEM_TERAPIA, linha: undefined });
  });

  it("não costura linhas desalinhadas de um POST montado à mão", async () => {
    const formData = new FormData();
    formData.set("pacienteNome", "José Silva");
    formData.set("numeroRequisicao", "2026-001");
    formData.append("terapiaId", "1");
    formData.append("terapiaId", "2");
    // Só uma quantidade para duas terapias.
    formData.append("qtdAutorizada", "10");

    const estado = await criarRequisicaoAction({}, formData);

    // A segunda linha fica sem quantidade e é recusada, em vez de herdar em
    // silêncio a quantidade da primeira.
    expect(estado).toEqual({ erro: ERRO_QTD_INVALIDA, linha: 1 });
  });
});

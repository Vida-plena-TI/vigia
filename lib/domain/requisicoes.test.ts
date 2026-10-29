/**
 * Cadastro de requisição com o banco dublado.
 *
 * O que está sob teste é a decisão do nosso código: que o paciente é só
 * **procurado** (nunca criado — desde 28/10/2026 ele nasce pelo
 * encaminhamento), qual dos dois desfechos tomar diante de um número que
 * aquele paciente já tem (criar a requisição ou acrescentar terapias à que
 * existe), quando uma terapia repetida atualiza a guia em vez de criar outra,
 * e que a falha de uma linha de terapia **lança** de dentro da transação, em
 * vez de devolver `{ ok: false }` educadamente — devolver faria o Prisma
 * commitar o que já tivesse sido escrito.
 *
 * O SQL propriamente dito (a busca por `lower(nome)`, a unique do número)
 * é problema de `requisicoes.integration.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  /** O "banco". Cada teste ajusta antes de chamar a action. */
  const banco = {
    /** Paciente devolvido pela busca por nome; `null` = nome de ninguém. */
    paciente: { id: 10, nome: "José Silva" } as {
      id: number;
      nome: string;
    } | null,
    /**
     * `true` quando o paciente já tem requisição com o número pedido.
     *
     * Não é mais um caso de recusa: é o que escolhe o desfecho "acrescenta as
     * terapias à requisição existente".
     */
    numeroJaExiste: false,
    /**
     * `true` quando o paciente resolvido já tem encaminhamento (regra 15).
     *
     * O padrão é `true` porque o caminho feliz de todo teste deste arquivo
     * pressupõe um paciente que pode receber requisição; quem testa a recusa
     * é que vira a chave.
     */
    temEncaminhamento: true,
    /** Ids de terapia que existem no banco. */
    terapiasExistentes: [1, 2],
    /**
     * Terapias que a requisição existente (id 42) já tem, cada uma com o id
     * da sua guia. Só faz sentido com `numeroJaExiste`.
     */
    guiasDaPasta: [] as { id: number; terapiaId: number }[],
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

  /** O insert em lote do ramo que acrescenta terapias a uma pasta existente. */
  const criarGuias = vi.fn(async (args: { data: unknown[] }) => {
    escritas.push("requisicao_terapia");
    return { count: args.data.length };
  });

  /** As guias que a pasta já tem, filtradas pelas terapias pedidas. */
  const buscarGuias = vi.fn(
    async (args: { where: { terapiaId: { in: number[] } } }) =>
      banco.guiasDaPasta.filter((guia) =>
        args.where.terapiaId.in.includes(guia.terapiaId),
      ),
  );

  /** O UPDATE da guia de uma terapia que a pasta já tinha. */
  const atualizarGuia = vi.fn(async () => {
    escritas.push("requisicao_terapia:update");
    return {};
  });

  const buscarEncaminhamento = vi.fn(async () =>
    banco.temEncaminhamento ? { id: 7 } : null,
  );

  const buscarTerapias = vi.fn(
    async (args: { where: { id: { in: number[] } } }) =>
      args.where.id.in
        .filter((id) => banco.terapiasExistentes.includes(id))
        .map((id) => ({ id })),
  );

  /**
   * A busca do paciente é a única consulta crua da função — e ela **não
   * escreve**: um INSERT em `paciente` aqui é exatamente o que não pode mais
   * acontecer.
   *
   * `valores` são os parâmetros interpolados no template — é por eles que os
   * testes conferem que o nome chegou trimado.
   */
  const consultar = vi.fn(
    async (partes: TemplateStringsArray, ...valores: unknown[]) => {
      void valores;

      const sql = partes.join(" ");

      if (/INSERT/i.test(sql)) {
        escritas.push("paciente");
        throw new Error(`a requisicao nao pode criar paciente: ${sql}`);
      }

      if (sql.includes("FOR KEY SHARE")) {
        return banco.paciente ? [banco.paciente] : [];
      }

      // O lock das guias que a caixinha "Substituir" apagaria. O dublê não
      // tem guias em outras requisições: a substituição em si é coberta em
      // `requisicoes-substituicao.integration.test.ts`. Aqui só importa
      // **se** a consulta foi feita.
      if (sql.includes("FOR UPDATE OF rt")) {
        return [];
      }

      throw new Error(`consulta nao prevista pelo teste: ${sql}`);
    },
  );

  /**
   * Simula a atomicidade: se o callback lançar, o que foi escrito é descartado
   * — que é exatamente o que o Postgres faz no rollback.
   */
  const transacao = vi.fn(
    async (executar: (tx: unknown) => Promise<unknown>) => {
      try {
        return await executar({
          $queryRaw: consultar,
          encaminhamento: { findFirst: buscarEncaminhamento },
          requisicao: { findFirst: buscarRequisicao, create: criarRequisicao },
          requisicaoTerapia: {
            createMany: criarGuias,
            findMany: buscarGuias,
            update: atualizarGuia,
          },
          terapia: { findMany: buscarTerapias },
        });
      } catch (erro) {
        escritas.length = 0;
        throw erro;
      }
    },
  );

  // A action pede permissao para a rota, nao so autenticacao (Fase C). O
  // dublê responde como um admin; a recusa por papel e afirmada em
  // `acesso-por-papel.test.ts`, que roda a regra de verdade contra o banco.
  const autorizarRota = vi.fn(async () => ({
    id: 1,
    username: "admin",
    papel: "admin" as const,
  }));

  const refresh = vi.fn();

  return {
    atualizarGuia,
    autorizarRota,
    banco,
    buscarEncaminhamento,
    buscarGuias,
    buscarRequisicao,
    buscarTerapias,
    consultar,
    criarGuias,
    criarRequisicao,
    escritas,
    refresh,
    transacao,
  };
});

vi.mock("@/lib/db", () => ({
  getPrismaClient: () => ({ $transaction: mocks.transacao }),
}));

vi.mock("@/lib/auth/current-user", () => ({
  autorizarRota: mocks.autorizarRota,
}));

vi.mock("next/cache", () => ({ refresh: mocks.refresh }));

import {
  APOIO_SUBSTITUIR,
  avisoDeRequisicoesApagadas,
  criarRequisicao,
  descreverItemDeSubstituicao,
  ERRO_NUMERO_OBRIGATORIO,
  ERRO_PACIENTE_NAO_CADASTRADO,
  ERRO_PACIENTE_OBRIGATORIO,
  ERRO_QTD_INVALIDA,
  ERRO_SEM_ENCAMINHAMENTO,
  ERRO_SEM_TERAPIA,
  ERRO_TERAPIA_INEXISTENTE,
  ERRO_TERAPIA_OBRIGATORIA,
  ERRO_TERAPIA_REPETIDA_NO_ENVIO,
  ERRO_VALIDADE_INVALIDA,
  erroCorridaNaGuia,
  erroCorridaNaRequisicao,
  mensagemDeCriacao,
  mensagemDeSubstituicao,
  ROTULO_SUBSTITUIR,
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
  mocks.banco.paciente = { id: 10, nome: "José Silva" };
  mocks.banco.numeroJaExiste = false;
  mocks.banco.temEncaminhamento = true;
  mocks.banco.terapiasExistentes = [1, 2];
  mocks.banco.guiasDaPasta = [];
  mocks.escritas.length = 0;
});

describe("criarRequisicao — paciente só é procurado, nunca criado", () => {
  it("cria a requisição no paciente encontrado", async () => {
    const resultado = await criarRequisicao(entrada());

    expect(resultado).toEqual({
      ok: true,
      requisicaoId: 99,
      numeroRequisicao: "2026-001",
      pacienteNome: "José Silva",
      requisicaoCriada: true,
      terapiasAdicionadas: 1,
      terapiasAtualizadas: 0,
      substituidas: [],
      requisicoesApagadas: [],
    });
    // Só a requisição foi escrita; nada em `paciente`.
    expect(mocks.escritas).toEqual(["requisicao"]);
  });

  it("recusa o nome que não é de paciente nenhum, sem escrever nada", async () => {
    mocks.banco.paciente = null;

    const resultado = await criarRequisicao(
      entrada({ pacienteNome: "Nome Nunca Visto" }),
    );

    expect(resultado).toEqual({
      ok: false,
      erro: ERRO_PACIENTE_NAO_CADASTRADO,
    });
    expect(mocks.escritas).toEqual([]);
    // Nem chega a perguntar por encaminhamento, número ou terapias.
    expect(mocks.buscarEncaminhamento).not.toHaveBeenCalled();
    expect(mocks.buscarRequisicao).not.toHaveBeenCalled();
    expect(mocks.criarRequisicao).not.toHaveBeenCalled();
  });

  it("a mensagem de não cadastrado não repete o nome digitado", async () => {
    mocks.banco.paciente = null;

    const resultado = await criarRequisicao(
      entrada({ pacienteNome: "Fulano Inexistente" }),
    );

    expect(resultado.ok).toBe(false);
    expect(JSON.stringify(resultado)).not.toContain("Fulano");
  });

  it("procura o paciente com lock, sem INSERT", async () => {
    await criarRequisicao(entrada());

    const [partes] = mocks.consultar.mock.calls[0];
    const sql = (partes as TemplateStringsArray).join(" ");
    expect(sql).toContain("FOR KEY SHARE");
    expect(sql).not.toMatch(/INSERT/i);
  });

  it("reaproveita o paciente existente em vez de criar outro", async () => {
    // A busca achou o nome com outra caixa.
    mocks.banco.paciente = { id: 7, nome: "José Silva" };

    const resultado = await criarRequisicao(
      entrada({ pacienteNome: "JOSÉ SILVA" }),
    );

    expect(resultado).toMatchObject({ ok: true });
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

    // O nome trimado é o que vai para a busca; sem isso "José Silva " não
    // acharia "José Silva" — o espaço não é caixa, e `lower(nome)` não o
    // ignora.
    const [, nome] = mocks.consultar.mock.calls[0];
    expect(nome).toBe("José Silva");

    expect(mocks.criarRequisicao).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ numeroRequisicao: "2026-001" }),
      }),
    );
  });
});

describe("criarRequisicao — número que o paciente já tem", () => {
  it("acrescenta as terapias à requisição existente em vez de recusar", async () => {
    mocks.banco.numeroJaExiste = true;

    const resultado = await criarRequisicao(
      entrada({
        linhas: [
          { terapiaId: 1, qtdAutorizada: 10, validade: null },
          { terapiaId: 2, qtdAutorizada: 4, validade: "2026-06-30" },
        ],
      }),
    );

    // O `requisicaoId` é o da pasta que já existia (42), não um novo: a
    // requisição não foi recriada.
    expect(resultado).toEqual({
      ok: true,
      requisicaoId: 42,
      numeroRequisicao: "2026-001",
      pacienteNome: "José Silva",
      requisicaoCriada: false,
      terapiasAdicionadas: 2,
      terapiasAtualizadas: 0,
      substituidas: [],
      requisicoesApagadas: [],
    });
  });

  it("não tenta criar uma segunda linha de requisicao", async () => {
    mocks.banco.numeroJaExiste = true;

    await criarRequisicao(entrada());

    // Era exatamente este INSERT que estourava a unique
    // `(paciente_id, numero_requisicao)`. O ramo que acrescenta nem chega a
    // tentá-lo — não há duplicata a evitar, há um INSERT que não acontece.
    expect(mocks.criarRequisicao).not.toHaveBeenCalled();
    expect(mocks.escritas).toEqual(["requisicao_terapia"]);
  });

  it("grava as linhas novas sob o requisicao_id que já existia", async () => {
    mocks.banco.numeroJaExiste = true;

    await criarRequisicao(
      entrada({
        linhas: [
          { terapiaId: 1, qtdAutorizada: 5, validade: null },
          { terapiaId: 2, qtdAutorizada: 3, validade: "2027-01-31" },
        ],
      }),
    );

    expect(mocks.criarGuias).toHaveBeenCalledWith({
      data: [
        { requisicaoId: 42, terapiaId: 1, qtdAutorizada: 5, validade: null },
        {
          requisicaoId: 42,
          terapiaId: 2,
          qtdAutorizada: 3,
          // A validade é por linha de `requisicao_terapia`: cada terapia
          // acrescentada carrega a sua, independente das que já estavam na
          // requisição.
          validade: new Date("2027-01-31T00:00:00.000Z"),
        },
      ],
    });
    expect(mocks.atualizarGuia).not.toHaveBeenCalled();
  });

  it("atualiza a guia da terapia que a pasta já tem em vez de criar outra", async () => {
    mocks.banco.numeroJaExiste = true;
    mocks.banco.guiasDaPasta = [{ id: 500, terapiaId: 1 }];

    const resultado = await criarRequisicao(
      entrada({
        linhas: [{ terapiaId: 1, qtdAutorizada: 8, validade: "2027-01-31" }],
      }),
    );

    expect(resultado).toMatchObject({
      ok: true,
      requisicaoId: 42,
      requisicaoCriada: false,
      terapiasAdicionadas: 0,
      terapiasAtualizadas: 1,
    });
    // UPDATE no `id` da guia que já estava lá — nunca DELETE + INSERT, que
    // levaria os atendimentos dela pelo cascade.
    expect(mocks.atualizarGuia).toHaveBeenCalledWith({
      where: { id: 500 },
      data: {
        qtdAutorizada: 8,
        validade: new Date("2027-01-31T00:00:00.000Z"),
      },
    });
    // Nada novo a inserir: o `createMany` nem é chamado com lista vazia.
    expect(mocks.criarGuias).not.toHaveBeenCalled();
  });

  it("procura as guias só dentro da requisição existente", async () => {
    mocks.banco.numeroJaExiste = true;

    await criarRequisicao(entrada());

    // Sem o `requisicaoId`, a guia da mesma terapia em outra requisição do
    // paciente (ou de outra pessoa) seria atualizada no lugar desta.
    expect(mocks.buscarGuias).toHaveBeenCalledWith({
      where: { requisicaoId: 42, terapiaId: { in: [1] } },
      select: { id: true, terapiaId: true },
    });
  });

  it("separa, no mesmo envio, a terapia repetida da terapia nova", async () => {
    mocks.banco.numeroJaExiste = true;
    mocks.banco.guiasDaPasta = [{ id: 500, terapiaId: 1 }];

    const resultado = await criarRequisicao(
      entrada({
        linhas: [
          { terapiaId: 1, qtdAutorizada: 8, validade: null },
          { terapiaId: 2, qtdAutorizada: 3, validade: null },
        ],
      }),
    );

    expect(resultado).toMatchObject({
      ok: true,
      terapiasAdicionadas: 1,
      terapiasAtualizadas: 1,
    });
    expect(mocks.atualizarGuia).toHaveBeenCalledTimes(1);
    expect(mocks.criarGuias).toHaveBeenCalledWith({
      data: [
        { requisicaoId: 42, terapiaId: 2, qtdAutorizada: 3, validade: null },
      ],
    });
  });

  it("não atualiza nada se uma terapia do envio não existe", async () => {
    mocks.banco.numeroJaExiste = true;
    mocks.banco.guiasDaPasta = [{ id: 500, terapiaId: 1 }];
    mocks.banco.terapiasExistentes = [1];

    const resultado = await criarRequisicao(
      entrada({
        linhas: [
          { terapiaId: 1, qtdAutorizada: 8, validade: null },
          { terapiaId: 404, qtdAutorizada: 3, validade: null },
        ],
      }),
    );

    expect(resultado).toMatchObject({ ok: false, linha: 1 });
    expect(mocks.atualizarGuia).not.toHaveBeenCalled();
    expect(mocks.escritas).toEqual([]);
  });

  it("recusa a terapia inexistente sem gravar nenhuma das linhas novas", async () => {
    mocks.banco.numeroJaExiste = true;
    mocks.banco.terapiasExistentes = [1];

    const resultado = await criarRequisicao(
      entrada({
        linhas: [
          { terapiaId: 1, qtdAutorizada: 10, validade: null },
          { terapiaId: 404, qtdAutorizada: 4, validade: null },
        ],
      }),
    );

    expect(resultado).toMatchObject({ ok: false, linha: 1 });
    // Nem a linha boa entrou: a conferência acontece antes de qualquer insert,
    // e o `throw` desfaz a transação inteira.
    expect(mocks.criarGuias).not.toHaveBeenCalled();
    expect(mocks.escritas).toEqual([]);
  });

  it("procura o número dentro do paciente, não no sistema inteiro", async () => {
    await criarRequisicao(entrada());

    // A unicidade é por paciente (CONTEXT.md): sem o `pacienteId` no filtro, as
    // terapias acabariam penduradas na requisição de outra pessoa que por acaso
    // usa o mesmo número.
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
      erro: erroCorridaNaRequisicao("2026-001", "José Silva"),
    });
  });

  it("traduz o adapter-pg, que manda o nome da unique fora de `target`", async () => {
    // Formato real do `@prisma/adapter-pg`: sem `meta.target`, com o nome da
    // constraint dentro de `driverAdapterError`.
    mocks.transacao.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        meta: {
          modelName: "Requisicao",
          driverAdapterError: {
            cause: {
              constraint: {
                index: "requisicao_paciente_id_numero_requisicao_key",
              },
            },
          },
        },
      }),
    );

    const resultado = await criarRequisicao(entrada());

    expect(resultado).toEqual({
      ok: false,
      erro: erroCorridaNaRequisicao("2026-001", "José Silva"),
    });
  });

  it("traduz a unique da guia quando dois envios trazem a mesma terapia nova", async () => {
    mocks.transacao.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        meta: {
          modelName: "RequisicaoTerapia",
          driverAdapterError: {
            cause: {
              constraint: {
                index: "requisicao_terapia_requisicao_id_terapia_id_key",
              },
            },
          },
        },
      }),
    );

    const resultado = await criarRequisicao(entrada());

    expect(resultado).toEqual({
      ok: false,
      erro: erroCorridaNaGuia("2026-001", "José Silva"),
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
          // Só descoberta contra o banco, depois das checagens do paciente:
          // é o caso que exige rollback de verdade.
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

describe("criarRequisicao — encaminhamento obrigatório (regra 15)", () => {
  it("recusa o paciente que não tem encaminhamento", async () => {
    mocks.banco.temEncaminhamento = false;

    const resultado = await criarRequisicao(entrada());

    expect(resultado).toEqual({ ok: false, erro: ERRO_SEM_ENCAMINHAMENTO });
  });

  it("paciente existente sem encaminhamento não escreve nada", async () => {
    mocks.banco.temEncaminhamento = false;

    await criarRequisicao(entrada());

    expect(mocks.escritas).toEqual([]);
    expect(mocks.criarRequisicao).not.toHaveBeenCalled();
  });

  it("pergunta pelo paciente resolvido, não pelo nome digitado", async () => {
    mocks.banco.paciente = { id: 33, nome: "José Silva" };

    await criarRequisicao(entrada());

    expect(mocks.buscarEncaminhamento).toHaveBeenCalledWith({
      where: { pacienteId: 33 },
      select: { id: true },
    });
  });

  it("checa o encaminhamento antes de gastar consulta com o número", async () => {
    mocks.banco.temEncaminhamento = false;

    await criarRequisicao(entrada());

    expect(mocks.buscarRequisicao).not.toHaveBeenCalled();
    expect(mocks.buscarTerapias).not.toHaveBeenCalled();
  });
});

describe("criarRequisicao — validação de entrada", () => {
  it.each([
    [
      "nome do paciente vazio",
      { pacienteNome: "   " },
      ERRO_PACIENTE_OBRIGATORIO,
    ],
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
          linhas: [{ terapiaId: 1, qtdAutorizada: quantidade, validade: null }],
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

  it("recusa a mesma terapia em duas linhas do envio, apontando a segunda", async () => {
    const resultado = await criarRequisicao(
      entrada({
        linhas: [
          { terapiaId: 1, qtdAutorizada: 5, validade: null },
          { terapiaId: 2, qtdAutorizada: 3, validade: null },
          { terapiaId: 1, qtdAutorizada: 8, validade: null },
        ],
      }),
    );

    // Uma guia por terapia: não há como saber qual das duas quantidades vale.
    expect(resultado).toEqual({
      ok: false,
      erro: ERRO_TERAPIA_REPETIDA_NO_ENVIO,
      linha: 2,
    });
    expect(mocks.transacao).not.toHaveBeenCalled();
  });

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
    // Sem sessão, `autorizarRota` nem chega a decidir por papel: o
    // `requireUsuario` de dentro dela redireciona para o login.
    mocks.autorizarRota.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

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
        requisicaoCriada: true,
        terapiasAdicionadas: 1,
        terapiasAtualizadas: 0,
        substituidas: [],
        requisicoesApagadas: [],
        token: expect.any(String),
      },
    });
  });

  it.each([
    ["ausente", undefined, false],
    ["vazio", "", false],
    ["com outro valor", "on", false],
    ["marcado", "sim", true],
  ])(
    "caixinha Substituir %s: só o valor exato consulta guias a substituir",
    async (_rotulo, valor, consulta) => {
      const dados = formulario();

      if (valor !== undefined) {
        dados.set("substituir", valor);
      }

      const estado = await criarRequisicaoAction({}, dados);

      expect(estado.sucesso).toBeDefined();

      const consultouSubstituicao = mocks.consultar.mock.calls.some(
        ([partes]) =>
          (partes as TemplateStringsArray)
            .join(" ")
            .includes("FOR UPDATE OF rt"),
      );

      expect(consultouSubstituicao).toBe(consulta);
    },
  );

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
    mocks.banco.temEncaminhamento = false;

    const estado = await criarRequisicaoAction({}, formulario());

    expect(estado).toEqual({
      erro: ERRO_SEM_ENCAMINHAMENTO,
      linha: undefined,
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("conta as terapias acrescentadas e atualizadas quando o número já existia", async () => {
    mocks.banco.numeroJaExiste = true;
    mocks.banco.guiasDaPasta = [{ id: 500, terapiaId: 2 }];

    const estado = await criarRequisicaoAction(
      {},
      formulario({
        linhas: [
          { terapiaId: "1", qtdAutorizada: "10", validade: "" },
          { terapiaId: "2", qtdAutorizada: "4", validade: "" },
        ],
      }),
    );

    // O formulário monta a confirmação com estes campos; sem eles, um envio
    // que só acrescentou terapias diria "Requisição criada", e uma guia
    // sobrescrita passaria por terapia nova.
    expect(estado.sucesso).toMatchObject({
      requisicaoCriada: false,
      terapiasAdicionadas: 1,
      terapiasAtualizadas: 1,
    });
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
          linhas: [{ terapiaId: "1", qtdAutorizada: quantidade, validade: "" }],
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

describe("mensagemDeCriacao", () => {
  it("anuncia a requisição nova pelo paciente", () => {
    expect(mensagemDeCriacao("José Silva", "2026-001", 3, 0, true)).toBe(
      "Requisição criada para José Silva.",
    );
  });

  it("anuncia a terapia acrescentada no singular", () => {
    expect(mensagemDeCriacao("José Silva", "2026-001", 1, 0, false)).toBe(
      "1 terapia adicionada à requisição 2026-001 de José Silva.",
    );
  });

  it("anuncia as terapias acrescentadas no plural", () => {
    // Os dois desfechos são sucesso, e a frase é o único lugar onde eles se
    // distinguem para quem digitou.
    expect(mensagemDeCriacao("José Silva", "2026-001", 3, 0, false)).toBe(
      "3 terapias adicionadas à requisição 2026-001 de José Silva.",
    );
  });

  it.each([
    [1, "1 terapia atualizada na requisição 2026-001 de José Silva."],
    [2, "2 terapias atualizadas na requisição 2026-001 de José Silva."],
  ])("anuncia %i guia(s) só atualizada(s)", (atualizadas, frase) => {
    expect(
      mensagemDeCriacao("José Silva", "2026-001", 0, atualizadas, false),
    ).toBe(frase);
  });

  it.each([
    [
      1,
      1,
      "1 terapia adicionada e 1 atualizada na requisição 2026-001 de José Silva.",
    ],
    [
      2,
      3,
      "2 terapias adicionadas e 3 atualizadas na requisição 2026-001 de José Silva.",
    ],
  ])(
    "conta %i adicionada(s) e %i atualizada(s) separadas",
    (adicionadas, atualizadas, frase) => {
      expect(
        mensagemDeCriacao(
          "José Silva",
          "2026-001",
          adicionadas,
          atualizadas,
          false,
        ),
      ).toBe(frase);
    },
  );
});

describe("mensagens da substituição", () => {
  it("a confirmação cita terapia, requisição antiga e atendimentos apagados", () => {
    expect(
      mensagemDeSubstituicao("444", [
        { terapiaNome: "Fono", numeroRequisicao: "333", atendimentos: 12 },
      ]),
    ).toBe(
      "Requisição 444 lançada. Substituído: Fono (requisição 333, 12 atendimentos apagados).",
    );
  });

  it("singular, zero e mais de uma guia", () => {
    expect(
      mensagemDeSubstituicao("9", [
        { terapiaNome: "Fono", numeroRequisicao: "1", atendimentos: 1 },
        { terapiaNome: "TO", numeroRequisicao: "2", atendimentos: 0 },
      ]),
    ).toBe(
      "Requisição 9 lançada. Substituído: Fono (requisição 1, 1 atendimento apagado); TO (requisição 2, nenhum atendimento apagado).",
    );
  });

  it("a linha do diálogo diz o que será apagado, sem o verbo no passado", () => {
    expect(
      descreverItemDeSubstituicao({
        terapiaNome: "Fono",
        numeroRequisicao: "333",
        atendimentos: 12,
      }),
    ).toBe("Fono (requisição 333, 12 atendimentos)");
  });

  it("aviso de requisição antiga apagada por ficar vazia", () => {
    expect(avisoDeRequisicoesApagadas(["333"])).toBe(
      "A requisição 333 ficou sem guias e foi apagada.",
    );
    expect(avisoDeRequisicoesApagadas(["1", "2"])).toBe(
      "As requisições 1, 2 ficaram sem guias e foram apagadas.",
    );
  });

  it("o texto de apoio da caixinha é o combinado", () => {
    expect(ROTULO_SUBSTITUIR).toBe("Substituir guias da mesma terapia");
    expect(APOIO_SUBSTITUIR).toBe(
      "Apaga a guia da mesma terapia em requisições antigas deste paciente, com os atendimentos já lançados.",
    );
  });
});

/**
 * A regra 9 do CONTEXT.md — exclusão de guia "Regular" bloqueada — é uma regra
 * de backend, não de interface.
 *
 * O sistema legado só escondia o botão. Um teste que clica no botão nunca
 * pegaria isso: o botão escondido não é clicável, e o teste passaria com a
 * validação inexistente. Por isso estes testes chamam a Server Action
 * `excluirGuia` **diretamente**, como faria um POST manual para o endpoint da
 * action — que é como uma Server Action é alcançável de fato.
 *
 * O banco é dublado: o que está sob teste é a decisão do nosso código a partir
 * do `status_alerta` que a view devolve, não o SQL. A contraparte contra o
 * Postgres real está em `guias.integration.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  /** O que o "banco" responde. Cada teste ajusta antes de chamar a action. */
  const banco = {
    guiaExiste: true,
    status: "Regular" as string,
  };

  const deletarGuia = vi.fn(async () => ({}));

  /**
   * `$queryRaw` é chamado como template tag; distinguimos as duas consultas
   * pelo texto para o teste não depender da ordem em que elas acontecem.
   */
  const consultar = vi.fn(async (partes: TemplateStringsArray) => {
    const sql = partes.join(" ");

    if (sql.includes("FOR UPDATE")) {
      return banco.guiaExiste ? [{ id: 7 }] : [];
    }

    if (sql.includes("status_alerta")) {
      return banco.guiaExiste ? [{ statusAlerta: banco.status }] : [];
    }

    throw new Error(`consulta nao prevista pelo teste: ${sql}`);
  });

  const transacao = vi.fn(
    async (executar: (tx: unknown) => Promise<unknown>) =>
      executar({
        $queryRaw: consultar,
        requisicaoTerapia: { delete: deletarGuia },
      }),
  );

  const requireUsuario = vi.fn(async () => ({ id: 1, username: "admin" }));
  const refresh = vi.fn();

  return { banco, consultar, deletarGuia, refresh, requireUsuario, transacao };
});

vi.mock("@/lib/db", () => ({
  getPrismaClient: () => ({ $transaction: mocks.transacao }),
}));

vi.mock("@/lib/auth/current-user", () => ({
  requireUsuario: mocks.requireUsuario,
}));

vi.mock("next/cache", () => ({ refresh: mocks.refresh }));

import { ERRO_GUIA_INEXISTENTE, ERRO_GUIA_REGULAR, ERRO_ID_INVALIDO } from "./guias";
import { excluirGuia } from "./guias-actions";

const ID_DA_GUIA = 7;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.banco.guiaExiste = true;
  mocks.banco.status = "Regular";
});

describe("excluirGuia (Server Action) — regra 9 do CONTEXT.md", () => {
  it("rejeita guia Regular mesmo chamada direto, sem passar pela UI", async () => {
    mocks.banco.status = "Regular";

    const resultado = await excluirGuia(ID_DA_GUIA);

    expect(resultado).toEqual({ ok: false, erro: ERRO_GUIA_REGULAR });
    // O ponto do teste: nada foi apagado. Se a validação vivesse só no `if`
    // que esconde o botão, este `delete` teria acontecido.
    expect(mocks.deletarGuia).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("aceita guia Renovar", async () => {
    mocks.banco.status = "Renovar";

    const resultado = await excluirGuia(ID_DA_GUIA);

    expect(resultado).toEqual({ ok: true });
    expect(mocks.deletarGuia).toHaveBeenCalledWith({
      where: { id: ID_DA_GUIA },
    });
  });

  it("aceita guia Esgotada", async () => {
    mocks.banco.status = "Esgotada";

    const resultado = await excluirGuia(ID_DA_GUIA);

    expect(resultado).toEqual({ ok: true });
    expect(mocks.deletarGuia).toHaveBeenCalledWith({
      where: { id: ID_DA_GUIA },
    });
  });

  it("exige usuário autenticado antes de tocar no banco", async () => {
    // `requireUsuario` redireciona lançando; simulamos a sessão ausente.
    mocks.requireUsuario.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

    await expect(excluirGuia(ID_DA_GUIA)).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.transacao).not.toHaveBeenCalled();
    expect(mocks.deletarGuia).not.toHaveBeenCalled();
  });

  it("lê o status só depois de travar a linha da guia", async () => {
    mocks.banco.status = "Esgotada";

    await excluirGuia(ID_DA_GUIA);

    // Sem o FOR UPDATE antes da leitura, um lançamento de atendimento
    // concorrente poderia devolver a guia para "Regular" entre a checagem e o
    // DELETE, e ela seria apagada assim mesmo.
    const [primeira, segunda] = mocks.consultar.mock.calls;

    expect(primeira[0].join(" ")).toContain("FOR UPDATE");
    expect(segunda[0].join(" ")).toContain("status_alerta");
  });

  it("rejeita guia inexistente sem apagar nada", async () => {
    mocks.banco.guiaExiste = false;

    const resultado = await excluirGuia(ID_DA_GUIA);

    expect(resultado).toEqual({ ok: false, erro: ERRO_GUIA_INEXISTENTE });
    expect(mocks.deletarGuia).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, Number.NaN])(
    "rejeita o id inválido %p sem abrir transação",
    async (id) => {
      const resultado = await excluirGuia(id);

      expect(resultado).toEqual({ ok: false, erro: ERRO_ID_INVALIDO });
      expect(mocks.transacao).not.toHaveBeenCalled();
      expect(mocks.deletarGuia).not.toHaveBeenCalled();
    },
  );
});

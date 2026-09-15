/**
 * A regra 9 do CONTEXT.md — exclusão de guia "Regular" bloqueada no backend —
 * foi revertida por decisão explícita do usuário: o status deixou de limitar a
 * exclusão. Estes testes guardam a decisão nova (qualquer status é excluível) e
 * o que continuou de pé: `FOR UPDATE` antes do DELETE, sessão obrigatória e
 * validação do id.
 *
 * Eles chamam a Server Action `excluirGuia` **diretamente**, como faria um POST
 * manual para o endpoint da action — que é como uma Server Action é alcançável
 * de fato, e o único jeito de provar que o backend não guarda mais nenhuma
 * restrição de status escondida atrás do botão.
 *
 * O banco é dublado: o que está sob teste é a decisão do nosso código, não o
 * SQL. A contraparte contra o Postgres real está em `guias.integration.test.ts`.
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
   * `$queryRaw` é chamado como template tag. O dublê ainda sabe responder a
   * consulta de `status_alerta` de propósito: se o código voltasse a perguntar
   * o status, o teste "não consulta o status" flagra, em vez de o dublê
   * estourar e confundir o motivo da falha.
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

import { ERRO_GUIA_INEXISTENTE, ERRO_ID_INVALIDO } from "./guias";
import { excluirGuia } from "./guias-actions";

const ID_DA_GUIA = 7;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.banco.guiaExiste = true;
  mocks.banco.status = "Regular";
});

describe("excluirGuia (Server Action)", () => {
  it.each(["Regular", "Renovar", "Esgotada"])(
    "exclui uma guia %s, chamada direto, sem passar pela UI",
    async (status) => {
      mocks.banco.status = status;

      const resultado = await excluirGuia(ID_DA_GUIA);

      expect(resultado).toEqual({ ok: true });
      expect(mocks.deletarGuia).toHaveBeenCalledWith({
        where: { id: ID_DA_GUIA },
      });
      expect(mocks.refresh).toHaveBeenCalled();
    },
  );

  it("não consulta o status da guia para decidir", async () => {
    mocks.banco.status = "Regular";

    await excluirGuia(ID_DA_GUIA);

    // O ponto da reversão: "Regular" não é mais um veto. Se alguém recolocar a
    // checagem, ela precisa do status — e esta consulta reaparece.
    const consultas = mocks.consultar.mock.calls.map(([partes]) =>
      partes.join(" "),
    );

    expect(consultas.some((sql) => sql.includes("status_alerta"))).toBe(false);
  });

  it("exige usuário autenticado antes de tocar no banco", async () => {
    // `requireUsuario` redireciona lançando; simulamos a sessão ausente.
    mocks.requireUsuario.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

    await expect(excluirGuia(ID_DA_GUIA)).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.transacao).not.toHaveBeenCalled();
    expect(mocks.deletarGuia).not.toHaveBeenCalled();
  });

  it("trava a linha da guia com FOR UPDATE antes de apagar", async () => {
    mocks.banco.status = "Regular";

    await excluirGuia(ID_DA_GUIA);

    // Sem o FOR UPDATE, um lançamento de atendimento concorrente (regra 7, que
    // trava as mesmas linhas) poderia gravar num intervalo em que esta guia já
    // está a caminho do DELETE.
    const [travamento] = mocks.consultar.mock.calls;

    expect(travamento[0].join(" ")).toContain("FOR UPDATE");
    expect(mocks.consultar.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deletarGuia.mock.invocationCallOrder[0],
    );
  });

  it("rejeita guia inexistente sem apagar nada", async () => {
    mocks.banco.guiaExiste = false;

    const resultado = await excluirGuia(ID_DA_GUIA);

    expect(resultado).toEqual({ ok: false, erro: ERRO_GUIA_INEXISTENTE });
    expect(mocks.deletarGuia).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
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

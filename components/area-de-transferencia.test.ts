/**
 * A cópia de verdade, sem React: o caminho novo, o plano B e a falha.
 *
 * O ambiente do Vitest é `node`, sem DOM; `navigator` e `document` entram como
 * dublês pelo parâmetro que a função já recebe.
 */
import { describe, expect, it, vi } from "vitest";

import { escreverNaAreaDeTransferencia } from "./area-de-transferencia";

function documentoFalso(resultadoDoExecCommand: boolean | "estoura") {
  const campo = {
    value: "",
    style: {} as Record<string, string>,
    setAttribute: vi.fn(),
    select: vi.fn(),
  };
  const body = { appendChild: vi.fn(), removeChild: vi.fn() };
  const execCommand = vi.fn(() => {
    if (resultadoDoExecCommand === "estoura") {
      throw new Error("sem suporte");
    }
    return resultadoDoExecCommand;
  });

  const documento = {
    createElement: vi.fn(() => campo),
    body,
    execCommand,
  } as unknown as Document;

  return { documento, campo, body, execCommand };
}

describe("escreverNaAreaDeTransferencia", () => {
  it("copia exatamente o texto pelo navigator.clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const { documento, execCommand } = documentoFalso(true);

    const ok = await escreverNaAreaDeTransferencia("ABC12345", {
      navigator: { clipboard: { writeText } } as unknown as Navigator,
      document: documento,
    });

    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledExactlyOnceWith("ABC12345");
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("cai no execCommand quando o clipboard recusa, e limpa o campo temporário", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    const { documento, campo, body, execCommand } = documentoFalso(true);

    const ok = await escreverNaAreaDeTransferencia("123456", {
      navigator: { clipboard: { writeText } } as unknown as Navigator,
      document: documento,
    });

    expect(ok).toBe(true);
    expect(campo.value).toBe("123456");
    expect(campo.select).toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(body.removeChild).toHaveBeenCalledWith(campo);
  });

  it("cai no execCommand fora de contexto seguro (sem navigator.clipboard)", async () => {
    const { documento, execCommand } = documentoFalso(true);

    const ok = await escreverNaAreaDeTransferencia("123456", {
      navigator: {} as Navigator,
      document: documento,
    });

    expect(ok).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it.each([false, "estoura"] as const)(
    "devolve false quando nenhum caminho funciona (execCommand: %s)",
    async (resultado) => {
      const { documento, campo, body } = documentoFalso(resultado);

      const ok = await escreverNaAreaDeTransferencia("123456", {
        navigator: {} as Navigator,
        document: documento,
      });

      expect(ok).toBe(false);
      // O campo temporário sai do documento mesmo na falha.
      expect(body.removeChild).toHaveBeenCalledWith(campo);
    },
  );

  it("devolve false sem document nenhum", async () => {
    expect(await escreverNaAreaDeTransferencia("123456", {})).toBe(false);
  });
});

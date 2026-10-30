/**
 * O "Excluir" da aba Cadastro (30/10/2026): o botão aparece fechado, sem
 * diálogo, e o portão da confirmação digitada continua o mesmo de quando a
 * exclusão morava em Encaminhamentos.
 *
 * Renderizado para HTML estático (o ambiente do Vitest é `node`): o clique e o
 * diálogo ficam para o roteiro manual. O que se prova aqui é que o diálogo não
 * existe antes da contagem e que só a palavra libera o botão.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  confirmacaoValida,
  PALAVRA_DE_CONFIRMACAO,
} from "@/lib/domain/pacientes-mensagens";

// As actions puxariam sessão e banco; a renderização não as chama.
vi.mock("@/lib/domain/pacientes-actions", () => ({
  contarParaExcluirPaciente: vi.fn(),
  excluirPaciente: vi.fn(),
}));

import { ExcluirPaciente } from "./excluir-paciente";

describe("Excluir paciente pela aba Cadastro", () => {
  it("renderiza só o botão: o diálogo depende da contagem lida do banco", () => {
    const saida = renderToStaticMarkup(
      createElement(ExcluirPaciente, {
        pacienteId: 1,
        pacienteNome: "Fulano",
        convenio: "klini",
      }),
    );

    expect(saida).toContain('aria-label="Excluir cadastro de Fulano"');
    expect(saida).toContain(">Excluir</button>");
    expect(saida).not.toContain("Excluir tudo");
    expect(saida).not.toContain(PALAVRA_DE_CONFIRMACAO);
  });

  it("a confirmação continua exigindo a palavra EXCLUIR", () => {
    expect(PALAVRA_DE_CONFIRMACAO).toBe("EXCLUIR");
    expect(confirmacaoValida("EXCLUIR")).toBe(true);
    expect(confirmacaoValida(" excluir ")).toBe(true);

    for (const digitado of ["", "EXCLUI", "sim", "Fulano", "EXCLUIR TUDO"]) {
      expect(confirmacaoValida(digitado)).toBe(false);
    }
  });
});

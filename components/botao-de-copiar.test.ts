/**
 * O botão de copiar renderizado para HTML estático (o ambiente do Vitest é
 * `node`, sem DOM): nome acessível, rótulo visível, desabilitado e a região
 * `aria-live` montada desde o início. O clique e a troca por "Copiado" pedem
 * navegador — ver o roteiro manual no CONTEXT.md.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BotaoDeCopiar } from "./botao-de-copiar";

function html(props: Parameters<typeof BotaoDeCopiar>[0]): string {
  return renderToStaticMarkup(createElement(BotaoDeCopiar, props));
}

describe("BotaoDeCopiar", () => {
  it("com rótulo: texto visível e nome acessível com o paciente", () => {
    const saida = html({
      texto: "ABC12345",
      rotulo: "Copiar carteirinha",
      rotuloAcessivel: "Copiar carteirinha de Fulano",
    });

    expect(saida).toContain('aria-label="Copiar carteirinha de Fulano"');
    expect(saida).toContain("Copiar carteirinha</button>");
    expect(saida).toContain('type="button"');
    expect(saida).not.toContain('disabled=""');
  });

  it("sem rótulo: só o ícone, como no cabeçalho do painel", () => {
    const saida = html({
      texto: "Ana - 2026-0001",
      rotuloAcessivel: "Copiar nome e número da requisição de Ana",
    });

    expect(saida).toContain("lucide-copy");
    // Nada além do ícone dentro do botão.
    expect(saida).toMatch(/<button[^>]*><svg[^]*?<\/svg><\/button>/);
  });

  it("a região aria-live existe antes do clique, vazia", () => {
    const saida = html({
      texto: "ABC12345",
      rotulo: "Copiar",
      rotuloAcessivel: "Copiar carteirinha de Fulano",
    });

    expect(saida).toContain(
      '<span role="status" aria-live="polite" class="sr-only"></span>',
    );
    // O número não aparece em lugar nenhum além do que a tela já mostra.
    expect(saida).not.toContain("ABC12345");
  });

  it("desabilitado quando pedido", () => {
    const saida = html({
      texto: "",
      rotulo: "Copiar",
      rotuloAcessivel: "Copiar CRM de Fulano",
      disabled: true,
    });

    expect(saida).toMatch(/<button[^>]*disabled=""/);
  });
});

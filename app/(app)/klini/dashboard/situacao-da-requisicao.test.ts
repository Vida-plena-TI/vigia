/**
 * O botão que troca a situação da requisição aparece para o admin e some para
 * a recepção; o selo aparece para os dois.
 *
 * Esconder o botão é conveniência — a recusa de verdade é da Server Action, e
 * está provada em `lib/domain/situacao-requisicao.integration.test.ts`. Aqui o
 * que se prova é a ligação da tela com a regra: a decisão passa por
 * `podeAlterarSituacaoDeRequisicao`, a mesma função que a action usa.
 *
 * Sem DOM (o ambiente do Vitest é `node`): o componente é renderizado para
 * HTML estático e o teste lê a marcação.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { podeAlterarSituacaoDeRequisicao } from "@/lib/auth/acesso";
import type { PapelUsuario } from "@/lib/auth/papel";
import type { SituacaoDeRequisicao } from "@/lib/domain/situacao-requisicao";

// A action puxaria sessão e banco; a renderização não a chama.
vi.mock("@/lib/domain/situacao-requisicao-actions", () => ({
  alterarSituacaoDaRequisicaoAction: vi.fn(),
}));

import { SituacaoDaRequisicao } from "./situacao-da-requisicao";

function renderizar(papel: PapelUsuario, situacao: SituacaoDeRequisicao): string {
  return renderToStaticMarkup(
    createElement(SituacaoDaRequisicao, {
      guia: {
        requisicaoId: 5,
        numeroRequisicao: "REQ-77",
        pacienteNome: "Ana",
        situacaoRequisicao: situacao,
      },
      podeAlterar: podeAlterarSituacaoDeRequisicao(papel),
    }),
  );
}

describe("situação da requisição no painel", () => {
  it("recepção vê o selo e não vê botão", () => {
    for (const situacao of ["solicitada", "aprovada"] as const) {
      const html = renderizar("recepcao", situacao);

      expect(html).toContain(situacao === "solicitada" ? "Solicitada" : "Aprovada");
      expect(html).not.toContain("<button");
    }
  });

  it("admin vê \"Aprovar\" na solicitada, com aria-label descritivo", () => {
    const html = renderizar("admin", "solicitada");

    expect(html).toContain("Solicitada");
    expect(html).toMatch(/<button[^>]*>Aprovar<\/button>/);
    expect(html).toContain('aria-label="Aprovar a requisição REQ-77 de Ana');
  });

  it("admin vê \"Voltar para solicitada\" na aprovada", () => {
    const html = renderizar("admin", "aprovada");

    expect(html).toContain("Aprovada");
    expect(html).toMatch(/<button[^>]*>Voltar para solicitada<\/button>/);
    expect(html).toContain(
      'aria-label="Voltar a requisição REQ-77 de Ana para solicitada',
    );
  });

  it("as duas situações se distinguem por ícone e contorno, não só por cor", () => {
    const solicitada = renderizar("recepcao", "solicitada");
    const aprovada = renderizar("recepcao", "aprovada");

    expect(solicitada).toContain("lucide-clock");
    expect(solicitada).toContain("ring-1");
    expect(aprovada).toContain("lucide-circle-check");
    expect(aprovada).not.toContain("ring-1");
  });
});

/**
 * Cabeçalho do paciente recolhido: o indicador "Solicitada" aparece quando
 * qualquer guia é de requisição solicitada, e some quando todas estão
 * aprovadas — sem tirar o lugar do selo do pior status, do checkbox nem do
 * botão de copiar.
 *
 * Renderizado para HTML estático (o ambiente do Vitest é `node`). Os pacientes
 * começam recolhidos, então o que sai no HTML é exatamente o cabeçalho.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { GuiaDoDashboard, PacienteComGuias } from "@/lib/domain/guias";
import type { SituacaoDeRequisicao } from "@/lib/domain/situacao-requisicao";

// As actions puxariam sessão e banco; a renderização não as chama.
vi.mock("@/lib/domain/situacao-requisicao-actions", () => ({
  alterarSituacaoDaRequisicaoAction: vi.fn(),
}));
vi.mock("@/lib/domain/atendimentos-actions", () => ({
  editarAtendimento: vi.fn(),
  excluirAtendimento: vi.fn(),
}));
vi.mock("@/lib/domain/guias-actions", () => ({
  excluirGuia: vi.fn(),
  listarHistoricoDaGuia: vi.fn(),
}));

import { ListaDeGuias } from "./lista-de-guias";

function guia(
  id: number,
  situacaoRequisicao: SituacaoDeRequisicao,
  statusAlerta: GuiaDoDashboard["statusAlerta"] = "Regular",
): GuiaDoDashboard {
  return {
    id,
    pacienteId: 1,
    pacienteNome: "Ana",
    requisicaoId: id,
    numeroRequisicao: `REQ-${id}`,
    terapiaId: id,
    terapiaNome: `Terapia ${id}`,
    codigoTiss: "123",
    qtdAutorizada: 8,
    qtdUtilizada: 0,
    saldoRestante: 8,
    validade: null,
    statusAlerta,
    situacaoRequisicao,
  };
}

function cabecalho(guias: GuiaDoDashboard[]): string {
  const paciente: PacienteComGuias = { id: 1, nome: "Ana", guias };

  return renderToStaticMarkup(
    createElement(ListaDeGuias, {
      pacientes: [paciente],
      podeAlterarSituacao: true,
    }),
  );
}

describe("cabeçalho do paciente recolhido", () => {
  it("mostra 'Solicitada' quando qualquer guia é de requisição solicitada", () => {
    const html = cabecalho([guia(1, "aprovada", "Renovar"), guia(2, "solicitada")]);

    expect(html).toContain('data-status="Solicitada"');
    expect(html).toContain("lucide-clock");
    // Sem contagem: um indicador só, mesmo com mais de uma solicitada.
    expect(html.match(/data-status="Solicitada"/g)).toHaveLength(1);
    // Painel recolhido: nenhuma linha de guia, nenhum botão de aprovar.
    expect(html).not.toContain(">Aprovar<");
  });

  it("não mostra nada quando todas as requisições estão aprovadas", () => {
    const html = cabecalho([guia(1, "aprovada"), guia(2, "aprovada")]);

    expect(html).not.toContain('data-status="Solicitada"');
    expect(html).not.toContain('data-status="Aprovada"');
    expect(html).not.toContain("lucide-clock");
  });

  it("vem depois do pior status e mantém checkbox e copiar fora do botão de abrir", () => {
    const html = cabecalho([guia(1, "solicitada", "Esgotada")]);

    const pior = html.indexOf('data-status="Esgotada"');
    const solicitada = html.indexOf('data-status="Solicitada"');
    expect(pior).toBeGreaterThan(-1);
    expect(solicitada).toBeGreaterThan(pior);

    // O botão de abrir fecha antes do botão de copiar, e o checkbox vem antes
    // dele: os três controles continuam irmãos.
    const inicioDoAbrir = html.indexOf("aria-expanded");
    const fimDoAbrir = html.indexOf("</button>", inicioDoAbrir);
    expect(solicitada).toBeLessThan(fimDoAbrir);
    expect(html.indexOf('type="checkbox"')).toBeLessThan(inicioDoAbrir);
    expect(html.indexOf("aria-label=\"Copiar", fimDoAbrir)).toBeGreaterThan(fimDoAbrir);
  });
});

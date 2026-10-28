/**
 * Colunas de carteirinha e CRM na lista de Encaminhamentos: número por
 * escrito, um botão de copiar por campo com o nome do paciente no rótulo, e o
 * paciente antigo (campos nulos) com "falta preencher" e botão desabilitado.
 *
 * Renderizado para HTML estático (o ambiente do Vitest é `node`). Tabela e
 * blocos do celular saem os dois no HTML — quem esconde um ou outro é o CSS —,
 * por isso cada botão aparece duas vezes.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { EncaminhamentoNaLista } from "@/lib/domain/encaminhamentos";

// A exclusão puxaria sessão e banco; a renderização não a chama.
vi.mock("@/lib/domain/pacientes-actions", () => ({
  contarParaExcluirPaciente: vi.fn(),
  excluirPaciente: vi.fn(),
}));

import { ListaDeEncaminhamentos } from "./lista-de-encaminhamentos";

function linha(
  id: number,
  pacienteNome: string,
  numeroCarteirinha: string | null,
  crmMedico: string | null,
): EncaminhamentoNaLista {
  return {
    id,
    pacienteId: id,
    pacienteNome,
    numeroCarteirinha,
    crmMedico,
    dataEncaminhamento: "2026-10-01",
    dataVencimento: "2027-03-30",
    statusEncaminhamento: null,
  };
}

function html(encaminhamentos: EncaminhamentoNaLista[]): string {
  return renderToStaticMarkup(
    createElement(ListaDeEncaminhamentos, { encaminhamentos }),
  );
}

/** As tags `<button>` cujo `aria-label` é exatamente `rotulo`. */
function botoes(saida: string, rotulo: string): string[] {
  return [...saida.matchAll(/<button[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => tag.includes(`aria-label="${rotulo}"`));
}

describe("lista de encaminhamentos — carteirinha e CRM", () => {
  it("mostra as duas colunas novas além das atuais", () => {
    const saida = html([linha(1, "Fulano", "ABC12345", "123456")]);

    for (const coluna of [
      "Paciente",
      "Data do encaminhamento",
      "Vencimento",
      "Situação",
      "Carteirinha",
      "CRM",
      "Ações",
    ]) {
      expect(saida).toContain(`>${coluna}</th>`);
    }
  });

  it("paciente com dados: número por escrito e um botão por campo, habilitado", () => {
    const saida = html([linha(1, "Fulano", "ABC12345", "123456")]);

    expect(saida).toContain(">ABC12345</span>");
    expect(saida).toContain(">123456</span>");

    const carteirinha = botoes(saida, "Copiar carteirinha de Fulano");
    const crm = botoes(saida, "Copiar CRM de Fulano");

    // Tabela + bloco do celular.
    expect(carteirinha).toHaveLength(2);
    expect(crm).toHaveLength(2);
    for (const tag of [...carteirinha, ...crm]) {
      expect(tag).not.toContain('disabled=""');
    }

    // No bloco do celular o rótulo visível é o completo.
    expect(saida).toContain("Copiar carteirinha</button>");
    expect(saida).toContain("Copiar CRM</button>");
    expect(saida).not.toContain("falta preencher");
    expect(saida).not.toContain('id="dica-falta-preencher"');
  });

  it("paciente antigo (nulos): '—' com 'falta preencher', botões desabilitados e a dica", () => {
    const saida = html([
      linha(1, "Fulano", "ABC12345", "123456"),
      linha(2, "Antigo da Silva", null, null),
    ]);

    // Duas células por linha antiga (carteirinha e CRM), em tabela e bloco.
    expect(saida.match(/falta preencher/g)).toHaveLength(4);
    expect(saida).toContain('<span aria-hidden="true">— </span>');

    for (const rotulo of [
      "Copiar carteirinha de Antigo da Silva",
      "Copiar CRM de Antigo da Silva",
    ]) {
      const tags = botoes(saida, rotulo);
      expect(tags).toHaveLength(2);
      for (const tag of tags) {
        expect(tag).toContain('disabled=""');
      }
    }

    // O paciente completo continua com os botões habilitados.
    for (const tag of botoes(saida, "Copiar carteirinha de Fulano")) {
      expect(tag).not.toContain('disabled=""');
    }

    expect(saida).toContain('id="dica-falta-preencher"');
    expect(saida).toContain("mesmo nome");
    expect(saida).toContain("a carteirinha é obrigatória");
  });

  it("só um dos campos faltando: só aquele botão fica desabilitado", () => {
    const saida = html([linha(3, "Meio Termo", null, "654321")]);

    for (const tag of botoes(saida, "Copiar carteirinha de Meio Termo")) {
      expect(tag).toContain('disabled=""');
    }
    for (const tag of botoes(saida, "Copiar CRM de Meio Termo")) {
      expect(tag).not.toContain('disabled=""');
    }
  });
});

/**
 * Lista da aba Encaminhamentos da SulAmérica: colunas do painel mais
 * carteirinha e CRM (com botão de copiar só-ícone) e médico (só texto), e o
 * legado com "falta preencher" campo a campo.
 *
 * HTML estático (ambiente `node`): tabela e blocos do celular saem os dois —
 * quem esconde um ou outro é o CSS —, por isso cada botão aparece duas vezes.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { EncaminhamentoSulamericaNaLista } from "@/lib/domain/autorizacoes-sulamerica";

import { ListaDeEncaminhamentosSulamerica } from "./lista-de-encaminhamentos-sulamerica";

function linha(
  id: number,
  pacienteNome: string,
  numeroCarteirinha: string | null,
  crmMedico: string | null,
  nomeMedico: string | null,
): EncaminhamentoSulamericaNaLista {
  return {
    id,
    pacienteId: id,
    pacienteNome,
    dataInicio: "2026-10-01",
    prazoMeses: 6,
    dataVencimento: "2027-04-01",
    statusAutorizacao: "Vencido",
    numeroCarteirinha,
    crmMedico,
    nomeMedico,
  };
}

function html(encaminhamentos: EncaminhamentoSulamericaNaLista[]): string {
  return renderToStaticMarkup(
    createElement(ListaDeEncaminhamentosSulamerica, { encaminhamentos }),
  );
}

function botoes(saida: string, rotulo: string): string[] {
  return [...saida.matchAll(/<button[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => tag.includes(`aria-label="${rotulo}"`));
}

describe("lista de encaminhamentos SulAmérica", () => {
  it("mostra as colunas do painel mais carteirinha, CRM e médico", () => {
    const saida = html([linha(1, "Fulano", "ABC12345", "123456", "Dra. Ana")]);

    for (const coluna of [
      "Paciente",
      "Data do encaminhamento",
      "Prazo",
      "Vencimento",
      "Situação",
      "Carteirinha",
      "CRM",
      "Médico",
    ]) {
      expect(saida).toContain(`>${coluna}</th>`);
    }
    expect(saida).toContain("01/10/2026");
    expect(saida).toContain("6 meses");
    expect(saida).toContain("01/04/2027");
    // O selo do painel (texto, não só cor).
    expect(saida).toContain("Vencido");
  });

  it("carteirinha e CRM com botão só-ícone 36×36; médico só em texto", () => {
    const saida = html([linha(1, "Fulano", "ABC12345", "123456", "Dra. Ana D'Ávila")]);

    expect(saida).toContain(">ABC12345</span>");
    expect(saida).toContain(">123456</span>");
    expect(saida).toContain("Dra. Ana D&#x27;Ávila");

    const carteirinha = botoes(saida, "Copiar carteirinha de Fulano");
    const crm = botoes(saida, "Copiar CRM de Fulano");
    expect(carteirinha).toHaveLength(2);
    expect(crm).toHaveLength(2);
    for (const tag of [...carteirinha, ...crm]) {
      expect(tag).not.toContain('disabled=""');
      expect(tag).toContain('data-size="icon-lg"');
    }
    expect(carteirinha[0]).toContain('title="Copiar carteirinha de Fulano"');
    expect(crm[0]).toContain('title="Copiar CRM de Fulano"');
    expect(saida).not.toMatch(/>Copiar[^<]*<\/button>/);

    // Quatro botões (2 campos × tabela/bloco) e nenhum para o médico.
    expect(saida.match(/<button[^>]*><svg[^]*?<\/svg><\/button>/g)).toHaveLength(4);
    expect(saida).not.toMatch(/aria-label="Copiar (médico|nome)/i);
    expect(saida).not.toContain("falta preencher");
    expect(saida).not.toContain('id="dica-falta-preencher"');
  });

  it("legado (nulos): '— falta preencher' nos três campos, botões desabilitados e a dica", () => {
    const saida = html([
      linha(1, "Fulano", "ABC12345", "123456", "Dra. Ana"),
      linha(2, "Antigo da Silva", null, null, null),
    ]);

    // Três campos na linha antiga, em tabela e bloco.
    expect(saida.match(/falta preencher/g)).toHaveLength(6);
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
    for (const tag of botoes(saida, "Copiar carteirinha de Fulano")) {
      expect(tag).not.toContain('disabled=""');
    }

    expect(saida).toContain('id="dica-falta-preencher"');
    expect(saida).toContain("mesmo nome e a mesma data e prazo");
    expect(saida).toContain("substitui a autorização e muda o vencimento");
    expect(saida).toContain("nome do médico são exigidos");
  });

  it("só o médico faltando: carteirinha e CRM habilitados, médico com 'falta preencher'", () => {
    const saida = html([linha(3, "Meio Termo", "ABC12345", "654321", null)]);

    for (const tag of [
      ...botoes(saida, "Copiar carteirinha de Meio Termo"),
      ...botoes(saida, "Copiar CRM de Meio Termo"),
    ]) {
      expect(tag).not.toContain('disabled=""');
    }
    expect(saida.match(/falta preencher/g)).toHaveLength(2);
    expect(saida).toContain('id="dica-falta-preencher"');
  });

  it("a tabela tem rolagem lateral própria e só aparece a partir de lg", () => {
    const saida = html([linha(1, "Fulano", "ABC12345", "123456", "Dra. Ana")]);

    expect(saida).toContain('class="hidden overflow-x-auto lg:block"');
    expect(saida).toContain("lg:hidden");
  });
});

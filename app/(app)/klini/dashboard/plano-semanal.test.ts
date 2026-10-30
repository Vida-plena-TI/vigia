/**
 * A seção "Plano semanal" do painel aberto: uma linha por terapia, sem total;
 * sem plano, o texto — e o link para o Cadastro só quando há rota (admin).
 *
 * Renderizado para HTML estático (o ambiente do Vitest é `node`).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { TerapiaDoPlano } from "@/lib/domain/plano-terapias";

import { PlanoSemanal, textoDaTerapiaDoPlano } from "./plano-semanal";

const FONO: TerapiaDoPlano = { terapiaId: 1, terapiaNome: "Fono", minutosSemanais: 150 };
const TO: TerapiaDoPlano = { terapiaId: 2, terapiaNome: "TO", minutosSemanais: 45 };

function html(plano: TerapiaDoPlano[], rotaDoCadastro: string | null): string {
  return renderToStaticMarkup(createElement(PlanoSemanal, { plano, rotaDoCadastro }));
}

describe("textoDaTerapiaDoPlano", () => {
  it.each([
    [FONO, "Fono — 2 h 30 min por semana"],
    [TO, "TO — 45 min por semana"],
    [{ terapiaId: 3, terapiaNome: "Psico", minutosSemanais: 120 }, "Psico — 2 h por semana"],
    [{ terapiaId: 4, terapiaNome: "ABA", minutosSemanais: 10080 }, "ABA — 168 h por semana"],
  ])("%j → %j", (terapia, texto) => {
    expect(textoDaTerapiaDoPlano(terapia)).toBe(texto);
  });
});

describe("PlanoSemanal", () => {
  it("uma linha por terapia, na ordem recebida, sem total", () => {
    const saida = html([FONO, TO], "/klini/pacientes");

    expect(saida).toContain("Plano semanal");
    expect(saida.match(/<li>/g)).toHaveLength(2);
    expect(saida.indexOf("Fono — 2 h 30 min por semana")).toBeLessThan(
      saida.indexOf("TO — 45 min por semana"),
    );
    // Nada de soma: 2 h 30 min + 45 min não aparece em lugar nenhum.
    expect(saida).not.toContain("3 h 15 min");
    expect(saida).not.toMatch(/total/i);
    // Com plano, nem o aviso nem o link.
    expect(saida).not.toContain("não cadastrado");
    expect(saida).not.toContain("Cadastrar plano");
  });

  it("a seção é rotulada pelo próprio título", () => {
    const saida = html([FONO], null);
    const [, id] = saida.match(/aria-labelledby="([^"]+)"/)!;

    expect(saida).toMatch(new RegExp(`<h3 id="${id}"[^>]*>Plano semanal</h3>`));
  });

  it("sem plano, para o admin: texto e link para a aba Cadastro", () => {
    const saida = html([], "/klini/pacientes");

    expect(saida).toContain("Plano semanal não cadastrado.");
    expect(saida).toContain('href="/klini/pacientes"');
    expect(saida).toContain(">Cadastrar plano</a>");
    expect(saida).not.toContain("<li>");
  });

  it("sem plano, para a recepção: só o texto", () => {
    const saida = html([], null);

    expect(saida).toContain("Plano semanal não cadastrado.");
    expect(saida).not.toContain("Cadastrar plano");
    expect(saida).not.toContain("<a");
  });
});

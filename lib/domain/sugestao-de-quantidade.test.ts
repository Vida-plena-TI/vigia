/**
 * Quantidade autorizada sugerida pelo tempo semanal do plano (regra 27): uma
 * autorização por hora cheia, no mínimo uma, × 4 semanas.
 */
import { describe, expect, it } from "vitest";

import {
  autorizacoesPorSemana,
  QUANTIDADE_PADRAO_NO_MES,
  quantidadeSugeridaNoMes,
  SEMANAS_POR_MES,
} from "./tempo-semanal";

describe("sugestão de quantidade pelo tempo semanal", () => {
  it.each([
    [15, 1, 4],
    [30, 1, 4],
    [45, 1, 4],
    [60, 1, 4],
    [90, 1, 4],
    [120, 2, 8],
    [150, 2, 8],
    [180, 3, 12],
    [240, 4, 16],
  ])("%i min → %i por semana, %i no mês", (minutos, porSemana, noMes) => {
    expect(autorizacoesPorSemana(minutos)).toBe(porSemana);
    expect(quantidadeSugeridaNoMes(minutos)).toBe(noMes);
  });

  it("a fração de hora não arredonda para cima (3 h 30 min → 3)", () => {
    expect(autorizacoesPorSemana(210)).toBe(3);
    expect(quantidadeSugeridaNoMes(210)).toBe(12);
  });

  it("o mês conta 4 semanas", () => {
    expect(SEMANAS_POR_MES).toBe(4);
    expect(quantidadeSugeridaNoMes(10_080)).toBe(168 * SEMANAS_POR_MES);
  });

  it.each([0, -15, -60, 0.5, 59.9, Number.NaN, Infinity, -Infinity])(
    "entrada inválida %s → 1 por semana e o padrão 4 no mês",
    (minutos) => {
      expect(autorizacoesPorSemana(minutos)).toBe(1);
      expect(quantidadeSugeridaNoMes(minutos)).toBe(QUANTIDADE_PADRAO_NO_MES);
      expect(QUANTIDADE_PADRAO_NO_MES).toBe(4);
    },
  );

  it("valor que não é número (payload adulterado) também cai no padrão", () => {
    const texto = "120" as unknown as number;

    expect(autorizacoesPorSemana(texto)).toBe(1);
    expect(quantidadeSugeridaNoMes(texto)).toBe(4);
  });
});

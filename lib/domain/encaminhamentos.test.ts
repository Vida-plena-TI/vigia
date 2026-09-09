/**
 * Testes da validação de entrada do cadastro de encaminhamento.
 *
 * O que **não** está aqui é a parte mais importante: não existe teste do
 * cálculo de vencimento em TypeScript porque não existe cálculo de vencimento
 * em TypeScript. Os 180 dias corridos são responsabilidade da coluna gerada do
 * Postgres, e quem prova que ela acerta é `encaminhamentos.integration.test.ts`.
 */
import { describe, expect, it } from "vitest";

import {
  ERRO_DATA_INVALIDA,
  ERRO_DATA_OBRIGATORIA,
  ERRO_PACIENTE_OBRIGATORIO,
  validarEntrada,
} from "./encaminhamentos";

describe("validarEntrada", () => {
  it("aceita paciente e data preenchidos", () => {
    expect(
      validarEntrada({
        pacienteNome: "Ana Beatriz Moraes",
        dataEncaminhamento: "2026-11-15",
      }),
    ).toEqual({ ok: true });
  });

  it("aceita nome e data com espaço sobrando (o trim é de quem grava)", () => {
    expect(
      validarEntrada({
        pacienteNome: "  Ana Beatriz Moraes  ",
        dataEncaminhamento: "  2026-11-15  ",
      }),
    ).toEqual({ ok: true });
  });

  it("recusa paciente vazio", () => {
    expect(
      validarEntrada({ pacienteNome: "   ", dataEncaminhamento: "2026-11-15" }),
    ).toEqual({ ok: false, erro: ERRO_PACIENTE_OBRIGATORIO });
  });

  it("recusa data vazia", () => {
    expect(
      validarEntrada({ pacienteNome: "Ana", dataEncaminhamento: "" }),
    ).toEqual({ ok: false, erro: ERRO_DATA_OBRIGATORIA });
  });

  it("recusa data fora do formato AAAA-MM-DD", () => {
    expect(
      validarEntrada({ pacienteNome: "Ana", dataEncaminhamento: "15/11/2026" }),
    ).toEqual({ ok: false, erro: ERRO_DATA_INVALIDA });
  });

  it("recusa data que não existe no calendário", () => {
    // `new Date("2026-02-31")` normalizaria para 03/03 em silêncio; o formato
    // sozinho não basta.
    expect(
      validarEntrada({ pacienteNome: "Ana", dataEncaminhamento: "2026-02-31" }),
    ).toEqual({ ok: false, erro: ERRO_DATA_INVALIDA });

    // 2026 não é bissexto.
    expect(
      validarEntrada({ pacienteNome: "Ana", dataEncaminhamento: "2026-02-29" }),
    ).toEqual({ ok: false, erro: ERRO_DATA_INVALIDA });
  });

  it("aceita 29 de fevereiro em ano bissexto", () => {
    expect(
      validarEntrada({ pacienteNome: "Ana", dataEncaminhamento: "2028-02-29" }),
    ).toEqual({ ok: true });
  });

  it("recusa mês e dia fora de faixa", () => {
    for (const dataEncaminhamento of ["2026-13-01", "2026-00-10", "2026-11-32"]) {
      expect(validarEntrada({ pacienteNome: "Ana", dataEncaminhamento })).toEqual(
        { ok: false, erro: ERRO_DATA_INVALIDA },
      );
    }
  });
});

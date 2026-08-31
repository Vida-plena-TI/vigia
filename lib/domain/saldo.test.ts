/**
 * Testes das formulas de saldo em TypeScript.
 *
 * Sao a especificacao executavel das regras do CONTEXT.md ("Campos calculados").
 * A comparacao com a view SQL, que e a fonte de verdade em producao, esta em
 * `saldo.integration.test.ts`.
 */
import { describe, expect, it } from "vitest";

import {
  calcularSaldo,
  creditosPorSessao,
  diasAteValidade,
  qtdUtilizada,
  saldoRestante,
  statusAlerta,
} from "./saldo";

/** Data (sem hora) em UTC, do jeito que uma coluna DATE chega do Postgres. */
function dia(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

const HOJE = dia("2026-08-31");

/** Hoje + n dias, para as bordas de validade. */
function emDias(n: number): Date {
  const d = new Date(HOJE);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

describe("qtdUtilizada", () => {
  it("soma zero quando a guia nao tem atendimento", () => {
    expect(qtdUtilizada([])).toBe(0);
  });

  it("soma os creditos consumidos dos atendimentos", () => {
    expect(qtdUtilizada([1, 1, 2, 3])).toBe(7);
  });

  it("conta atendimento de 0 credito sem quebrar (edicao permite 0)", () => {
    expect(qtdUtilizada([1, 0, 2])).toBe(3);
  });

  it("trata nulo como 0, igual ao COALESCE da view", () => {
    expect(qtdUtilizada([1, null, undefined, 2])).toBe(3);
  });
});

describe("saldoRestante", () => {
  it("subtrai o utilizado do autorizado", () => {
    expect(saldoRestante(20, 8)).toBe(12);
  });

  it("da 0 quando tudo foi consumido", () => {
    expect(saldoRestante(20, 20)).toBe(0);
  });

  it("nao faz clamp: saldo estourado fica negativo", () => {
    expect(saldoRestante(20, 25)).toBe(-5);
  });

  it("trata qtd_autorizada nula/0 como 0", () => {
    expect(saldoRestante(null, 3)).toBe(-3);
    expect(saldoRestante(0, 0)).toBe(0);
  });
});

describe("creditosPorSessao", () => {
  it("divide por 4 sem truncar (10 / 4 = 2.5, nao 2)", () => {
    expect(creditosPorSessao(10)).toBe(2.5);
  });

  it("mantem divisao exata quando o numero e multiplo de 4", () => {
    expect(creditosPorSessao(8)).toBe(2);
  });

  it("da 0 quando qtd_autorizada e 0", () => {
    expect(creditosPorSessao(0)).toBe(0);
  });

  it("da 0 quando qtd_autorizada e nula", () => {
    expect(creditosPorSessao(null)).toBe(0);
    expect(creditosPorSessao(undefined)).toBe(0);
  });
});

describe("diasAteValidade", () => {
  it("conta dias inteiros ignorando hora e fuso", () => {
    // Referencia com hora cheia: so o dia importa.
    expect(diasAteValidade(dia("2026-09-07"), new Date("2026-08-31T23:59:59Z")))
      .toBe(7);
  });

  it("atravessa virada de mes", () => {
    expect(diasAteValidade(dia("2026-09-01"), dia("2026-08-31"))).toBe(1);
  });

  it("e negativo para validade vencida", () => {
    expect(diasAteValidade(dia("2026-08-30"), HOJE)).toBe(-1);
  });
});

describe("statusAlerta — qtd_autorizada vazia", () => {
  it('da "Esgotada" quando qtd_autorizada e 0, mesmo sem consumo e com validade longe', () => {
    expect(
      statusAlerta(
        { qtdAutorizada: 0, qtdUtilizada: 0, validade: emDias(365) },
        HOJE,
      ),
    ).toBe("Esgotada");
  });

  it('da "Esgotada" quando qtd_autorizada e nula', () => {
    expect(
      statusAlerta({ qtdAutorizada: null, qtdUtilizada: 0, validade: null }, HOJE),
    ).toBe("Esgotada");
  });

  it("nao divide por zero: creditos_por_sessao fica 0 e nao vira limiar", () => {
    expect(calcularSaldo({ qtdAutorizada: 0, qtdUtilizada: 0, validade: null }, HOJE))
      .toEqual({
        qtdUtilizada: 0,
        saldoRestante: 0,
        creditosPorSessao: 0,
        statusAlerta: "Esgotada",
      });
  });
});

describe("statusAlerta — saldo", () => {
  it('da "Esgotada" com saldo exatamente 0', () => {
    expect(
      statusAlerta({ qtdAutorizada: 20, qtdUtilizada: 20, validade: null }, HOJE),
    ).toBe("Esgotada");
  });

  it('da "Esgotada" com saldo negativo', () => {
    expect(
      statusAlerta({ qtdAutorizada: 20, qtdUtilizada: 23, validade: null }, HOJE),
    ).toBe("Esgotada");
  });

  it('"Esgotada" tem precedencia sobre "Renovar" por validade', () => {
    expect(
      statusAlerta({ qtdAutorizada: 20, qtdUtilizada: 20, validade: emDias(1) }, HOJE),
    ).toBe("Esgotada");
  });

  it('da "Renovar" com saldo exatamente no limite de 25%', () => {
    // 20 autorizados => limiar 5. Saldo 5 e "<=", entao ja alerta.
    expect(
      statusAlerta({ qtdAutorizada: 20, qtdUtilizada: 15, validade: null }, HOJE),
    ).toBe("Renovar");
  });

  it('da "Regular" com saldo um credito acima do limite de 25%', () => {
    expect(
      statusAlerta({ qtdAutorizada: 20, qtdUtilizada: 14, validade: null }, HOJE),
    ).toBe("Regular");
  });

  it("usa o limiar fracionario (10 => 2.5) sem truncar", () => {
    expect(
      statusAlerta({ qtdAutorizada: 10, qtdUtilizada: 8, validade: null }, HOJE),
    ).toBe("Renovar");
    expect(
      statusAlerta({ qtdAutorizada: 10, qtdUtilizada: 7, validade: null }, HOJE),
    ).toBe("Regular");
  });
});

describe("statusAlerta — validade", () => {
  const saldoConfortavel = { qtdAutorizada: 20, qtdUtilizada: 0 };

  it('da "Renovar" com validade exatamente em 7 dias', () => {
    expect(statusAlerta({ ...saldoConfortavel, validade: emDias(7) }, HOJE))
      .toBe("Renovar");
  });

  it('da "Regular" com validade em 8 dias', () => {
    expect(statusAlerta({ ...saldoConfortavel, validade: emDias(8) }, HOJE))
      .toBe("Regular");
  });

  it('da "Renovar" com validade ja vencida', () => {
    expect(statusAlerta({ ...saldoConfortavel, validade: emDias(-1) }, HOJE))
      .toBe("Renovar");
  });

  it('da "Renovar" com validade hoje', () => {
    expect(statusAlerta({ ...saldoConfortavel, validade: HOJE }, HOJE))
      .toBe("Renovar");
  });

  it('validade nula nunca dispara "Renovar" por prazo', () => {
    expect(statusAlerta({ ...saldoConfortavel, validade: null }, HOJE))
      .toBe("Regular");
    expect(statusAlerta({ ...saldoConfortavel, validade: undefined }, HOJE))
      .toBe("Regular");
  });

  it('validade nula nao impede "Renovar" por saldo', () => {
    expect(
      statusAlerta({ qtdAutorizada: 20, qtdUtilizada: 16, validade: null }, HOJE),
    ).toBe("Renovar");
  });

  it("ignora a hora da data de referencia", () => {
    const fimDoDia = new Date("2026-08-31T23:30:00.000Z");
    expect(statusAlerta({ ...saldoConfortavel, validade: emDias(7) }, fimDoDia))
      .toBe("Renovar");
    expect(statusAlerta({ ...saldoConfortavel, validade: emDias(8) }, fimDoDia))
      .toBe("Regular");
  });
});

describe("calcularSaldo", () => {
  it("devolve os quatro campos calculados de uma guia regular", () => {
    expect(
      calcularSaldo(
        { qtdAutorizada: 10, qtdUtilizada: 3, validade: emDias(30) },
        HOJE,
      ),
    ).toEqual({
      qtdUtilizada: 3,
      saldoRestante: 7,
      creditosPorSessao: 2.5,
      statusAlerta: "Regular",
    });
  });
});

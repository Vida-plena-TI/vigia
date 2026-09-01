import { describe, expect, it } from "vitest";

import {
  numeroDaRequisicaoMaisRecente,
  piorStatus,
  textoDeCopia,
} from "./guias-apresentacao";
import type { StatusAlerta } from "./saldo";

function guia(
  statusAlerta: StatusAlerta,
  requisicaoId = 1,
  numeroRequisicao = "2026-0001",
) {
  return { statusAlerta, requisicaoId, numeroRequisicao };
}

describe("piorStatus", () => {
  it("devolve null para lista vazia", () => {
    expect(piorStatus([])).toBeNull();
  });

  it("devolve o único status quando há uma guia só", () => {
    expect(piorStatus([guia("Regular")])).toBe("Regular");
    expect(piorStatus([guia("Renovar")])).toBe("Renovar");
    expect(piorStatus([guia("Esgotada")])).toBe("Esgotada");
  });

  it("Esgotada vence Renovar e Regular", () => {
    expect(
      piorStatus([guia("Regular"), guia("Esgotada"), guia("Renovar")]),
    ).toBe("Esgotada");
  });

  it("Renovar vence Regular", () => {
    expect(piorStatus([guia("Regular"), guia("Renovar"), guia("Regular")])).toBe(
      "Renovar",
    );
  });

  it("só devolve Regular quando todas são Regular", () => {
    expect(piorStatus([guia("Regular"), guia("Regular")])).toBe("Regular");
  });

  it("não depende da ordem das guias", () => {
    const guias = [guia("Esgotada"), guia("Regular"), guia("Renovar")];

    expect(piorStatus(guias)).toBe(piorStatus([...guias].reverse()));
  });
});

describe("numeroDaRequisicaoMaisRecente", () => {
  it("devolve null para lista vazia", () => {
    expect(numeroDaRequisicaoMaisRecente([])).toBeNull();
  });

  it("devolve o número quando todas as guias vêm da mesma requisição", () => {
    expect(
      numeroDaRequisicaoMaisRecente([
        guia("Regular", 7, "2026-0001"),
        guia("Renovar", 7, "2026-0001"),
      ]),
    ).toBe("2026-0001");
  });

  // Caso defensivo: o schema permite (unique é por paciente + numero), a
  // interface não expõe.
  it("com números diferentes, usa o da requisição de maior id", () => {
    expect(
      numeroDaRequisicaoMaisRecente([
        guia("Regular", 3, "2026-0001"),
        guia("Renovar", 91, "2026-0042"),
        guia("Regular", 12, "56565"),
      ]),
    ).toBe("2026-0042");
  });

  it("não depende da ordem em que as guias chegaram", () => {
    const guias = [
      guia("Regular", 3, "2026-0001"),
      guia("Renovar", 91, "2026-0042"),
      guia("Regular", 12, "56565"),
    ];

    expect(numeroDaRequisicaoMaisRecente([...guias].reverse())).toBe(
      "2026-0042",
    );
  });
});

describe("textoDeCopia", () => {
  it("junta nome e número com hífen entre espaços", () => {
    expect(
      textoDeCopia("Ana Beatriz Moraes", [guia("Regular", 7, "2026-0001")]),
    ).toBe("Ana Beatriz Moraes - 2026-0001");
  });

  it("usa a requisição mais recente no caso defensivo", () => {
    expect(
      textoDeCopia("Mariana Souza Ribeiro", [
        guia("Esgotada", 4, "2026-0003"),
        guia("Regular", 88, "2026-0099"),
      ]),
    ).toBe("Mariana Souza Ribeiro - 2026-0099");
  });

  it("sem guia nenhuma copia só o nome, sem sufixo pendurado", () => {
    expect(textoDeCopia("Carlos Eduardo Lima", [])).toBe("Carlos Eduardo Lima");
  });

  it("preserva o nome exatamente como veio do banco", () => {
    expect(textoDeCopia("José Silva", [guia("Regular", 1, "0001")])).toBe(
      "José Silva - 0001",
    );
  });
});

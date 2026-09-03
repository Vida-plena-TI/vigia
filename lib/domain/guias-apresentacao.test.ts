import { describe, expect, it } from "vitest";

import {
  numeroDaRequisicaoMaisRecente,
  piorStatus,
  textoDeCopia,
  textoDeCopiaEmLote,
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

describe("textoDeCopiaEmLote", () => {
  const ana = {
    nome: "Ana Beatriz Moraes",
    guias: [guia("Regular", 1, "2026-0001")],
  };
  const bruno = {
    nome: "Bruno Carvalho",
    guias: [guia("Renovar", 2, "2026-0002")],
  };
  const carla = {
    nome: "Carla Nunes",
    guias: [guia("Esgotada", 3, "2026-0003")],
  };

  it("devolve texto vazio sem paciente nenhum", () => {
    expect(textoDeCopiaEmLote([])).toBe("");
  });

  it("com um paciente só é igual ao botão individual", () => {
    expect(textoDeCopiaEmLote([ana])).toBe(textoDeCopia(ana.nome, ana.guias));
  });

  // O que se cola numa mensagem: uma linha por paciente e nada pendurado no
  // fim — uma linha em branco sobrando é justamente o que se percebe ao colar.
  it("junta uma linha por paciente, sem quebra sobrando no fim", () => {
    expect(textoDeCopiaEmLote([ana, bruno, carla])).toBe(
      "Ana Beatriz Moraes - 2026-0001\n" +
        "Bruno Carvalho - 2026-0002\n" +
        "Carla Nunes - 2026-0003",
    );
  });

  it("respeita a ordem recebida, que é a ordem da lista do painel", () => {
    expect(textoDeCopiaEmLote([carla, ana])).toBe(
      "Carla Nunes - 2026-0003\nAna Beatriz Moraes - 2026-0001",
    );
  });

  it("aplica o caso defensivo do número em cada linha", () => {
    const comDuasRequisicoes = {
      nome: "Mariana Souza Ribeiro",
      guias: [guia("Esgotada", 4, "2026-0003"), guia("Regular", 88, "56565")],
    };

    expect(textoDeCopiaEmLote([ana, comDuasRequisicoes])).toBe(
      "Ana Beatriz Moraes - 2026-0001\nMariana Souza Ribeiro - 56565",
    );
  });

  it("paciente sem guia entra só com o nome, sem sufixo pendurado", () => {
    expect(textoDeCopiaEmLote([{ nome: "Carlos Eduardo Lima", guias: [] }, ana])).toBe(
      "Carlos Eduardo Lima\nAna Beatriz Moraes - 2026-0001",
    );
  });
});

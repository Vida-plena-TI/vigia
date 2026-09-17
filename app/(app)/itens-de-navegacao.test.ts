/**
 * O menu por convênio e papel.
 *
 * Esconder link nao protege nada (ver `acesso.test.ts` e `proxy.test.ts` para
 * as camadas que protegem); o que este teste guarda e que a recepcao nao ve uma
 * porta que nao abre — e que o admin nao perdeu nenhum item no caminho.
 */
import { describe, expect, it } from "vitest";

import { itensDeNavegacaoPara } from "./itens-de-navegacao";

const rotulos = (papel: "admin" | "recepcao", caminho: string) =>
  itensDeNavegacaoPara(papel, caminho).map((item) => item.rotulo);

describe("itensDeNavegacaoPara", () => {
  it.each([
    "/klini",
    "/klini/dashboard",
    "/klini/requisicoes/nova",
    "/klini/futura/subpagina",
    "/klini?busca=sulamerica",
  ])("admin ve so os cinco itens Klini em %s", (caminho) => {
    expect(rotulos("admin", caminho)).toEqual([
      "Painel",
      "Nova requisição",
      "Lançar atendimento",
      "Atendimentos de hoje",
      "Encaminhamentos",
    ]);
  });

  it("recepcao nao ve Nova requisição nem Encaminhamentos nem SulAmérica", () => {
    expect(rotulos("recepcao", "/klini/dashboard")).toEqual([
      "Painel",
      "Lançar atendimento",
      "Atendimentos de hoje",
    ]);
  });

  it.each([
    "/sulamerica",
    "/sulamerica/dashboard",
    "/sulamerica/futura/subpagina",
    "/sulamerica?busca=klini",
  ])("admin ve so o Painel SulAmerica em %s", (caminho) => {
    expect(itensDeNavegacaoPara("admin", caminho)).toEqual([
      { href: "/sulamerica/dashboard", rotulo: "Painel" },
    ]);
  });

  it("recepcao continua sem itens SulAmerica", () => {
    expect(itensDeNavegacaoPara("recepcao", "/sulamerica/dashboard")).toEqual([]);
  });

  it.each([
    "/",
    "/outra",
    "/klini-extra/dashboard",
    "/sulamerica-extra/dashboard",
  ])("nao mistura menus fora dos prefixos em %s", (caminho) => {
    expect(itensDeNavegacaoPara("admin", caminho)).toEqual([]);
  });

  it("trocar convenio nao faz parte de nenhuma lista", () => {
    for (const caminho of ["/klini/dashboard", "/sulamerica/dashboard"]) {
      expect(itensDeNavegacaoPara("admin", caminho).map((item) => item.href))
        .not.toContain("/");
    }
  });
});

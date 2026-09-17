/**
 * O menu por papel.
 *
 * Esconder link nao protege nada (ver `acesso.test.ts` e `proxy.test.ts` para
 * as camadas que protegem); o que este teste guarda e que a recepcao nao ve uma
 * porta que nao abre — e que o admin nao perdeu nenhum item no caminho.
 */
import { describe, expect, it } from "vitest";

import { itensDeNavegacaoPara } from "./itens-de-navegacao";

const rotulos = (papel: "admin" | "recepcao") =>
  itensDeNavegacaoPara(papel).map((item) => item.rotulo);

describe("itensDeNavegacaoPara", () => {
  it("admin ve os cinco itens, na ordem da faixa", () => {
    expect(rotulos("admin")).toEqual([
      "Painel",
      "Nova requisição",
      "Lançar atendimento",
      "Atendimentos de hoje",
      "Encaminhamentos",
    ]);
  });

  it("recepcao nao ve Nova requisição nem Encaminhamentos", () => {
    expect(rotulos("recepcao")).toEqual([
      "Painel",
      "Lançar atendimento",
      "Atendimentos de hoje",
    ]);
  });
});

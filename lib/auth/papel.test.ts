/**
 * O espelho em TypeScript do CHECK `usuario_papel_valido`.
 *
 * Estes testes nao tocam o banco; o que eles guardam e a correspondencia entre
 * `PAPEIS` e a lista da migration `20260917120000_papel_de_usuario`. A prova de
 * que o banco concorda esta em `criar-usuario.integration.test.ts`, que manda
 * um papel invalido e espera a recusa do Postgres.
 */
import { describe, expect, it } from "vitest";

import { PAPEIS, ehPapelValido } from "./papel";

describe("papel de usuario", () => {
  it("tem exatamente os dois papeis da migration, nessa ordem", () => {
    expect([...PAPEIS]).toEqual(["admin", "recepcao"]);
  });

  it("aceita os papeis conhecidos", () => {
    for (const papel of PAPEIS) {
      expect(ehPapelValido(papel)).toBe(true);
    }
  });

  it("recusa qualquer outra coisa", () => {
    // "Admin" com maiuscula inclusive: a comparacao e exata, como a do CHECK.
    for (const valor of [
      "Admin",
      "ADMIN",
      "medico",
      "",
      " admin",
      null,
      undefined,
      1,
      {},
    ]) {
      expect(ehPapelValido(valor)).toBe(false);
    }
  });
});

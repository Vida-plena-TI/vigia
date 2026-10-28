/**
 * Paciente só nasce pelo cadastro de encaminhamento (desde 28/10/2026).
 *
 * Varre o código de aplicação e os scripts atrás de quem chama o
 * get-or-create ou insere em `paciente` direto. A lista permitida é curta e
 * escrita aqui de propósito: um caminho novo que crie paciente tem de passar
 * por este teste, e com ele pela conversa sobre a regra.
 *
 * A SulAmérica está na lista **temporariamente** — até ganhar a própria aba de
 * encaminhamentos. O seed de desenvolvimento (`prisma/seed.ts`, nomes
 * fictícios) cria pacientes pelo Prisma e fica de fora da varredura.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "../..");

/** Arquivos `.ts`/`.tsx` de aplicação (sem testes nem código gerado). */
function arquivosDeAplicacao(): string[] {
  const arquivos: string[] = [];

  for (const pasta of ["app", "lib", "components", "scripts"]) {
    for (const arquivo of readdirSync(join(raiz, pasta), {
      recursive: true,
      encoding: "utf8",
    })) {
      if (
        !/\.(ts|tsx|mjs)$/.test(arquivo) ||
        /\.test\.ts$/.test(arquivo) ||
        arquivo.includes("generated")
      ) {
        continue;
      }

      arquivos.push(join(raiz, pasta, arquivo));
    }
  }

  return arquivos;
}

function quemContem(padrao: RegExp): string[] {
  return arquivosDeAplicacao()
    .filter((caminho) => padrao.test(readFileSync(caminho, "utf8")))
    .map((caminho) => relative(raiz, caminho))
    .sort();
}

describe("origem do paciente", () => {
  it("só encaminhamento (e, por ora, SulAmérica) chamam o get-or-create", () => {
    expect(quemContem(/\bobterOuCriarPaciente\(/)).toEqual([
      join("lib", "domain", "autorizacoes-sulamerica.ts"),
      join("lib", "domain", "encaminhamentos.ts"),
      join("lib", "domain", "pacientes.ts"),
    ]);
  });

  it("nenhum outro arquivo insere em paciente", () => {
    expect(quemContem(/INSERT\s+INTO\s+"?paciente"?\s*\(/i)).toEqual([
      join("lib", "domain", "pacientes.ts"),
    ]);
    expect(quemContem(/\.paciente\.(create|createMany|upsert)\(/)).toEqual([]);
  });
});

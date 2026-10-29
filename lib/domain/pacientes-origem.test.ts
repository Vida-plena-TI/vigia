/**
 * Paciente só nasce pelo cadastro de paciente com plano de terapias
 * (`cadastrarPaciente` em `plano-terapias.ts`, aba Cadastro de cada convênio)
 * — a **única** porta de entrada desde 29/10/2026 (regra 24). Os dois
 * cadastros de encaminhamento (Klini e SulAmérica) só acham paciente que já
 * existe.
 *
 * Varre o código de aplicação e os scripts atrás de quem chama o
 * get-or-create ou insere em `paciente` direto. A lista permitida é curta e
 * escrita aqui de propósito, **sem exceção temporária**: um caminho novo que
 * crie paciente tem de passar por este teste, e com ele pela conversa sobre a
 * regra. O seed de desenvolvimento (`prisma/seed.ts`, nomes fictícios) cria
 * pacientes pelo Prisma e fica de fora da varredura, como o preparo dos testes
 * de integração (`test/paciente-cadastrado.ts`, que passa pelo próprio
 * `cadastrarPacienteNaTransacao`).
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
  it("só o cadastro de paciente chama o get-or-create", () => {
    // `pacientes.ts` é a definição, não um chamador. Até 29/10/2026 a lista
    // tinha também `encaminhamentos.ts` e `autorizacoes-sulamerica.ts`.
    expect(quemContem(/\bobterOuCriarPaciente\(/)).toEqual([
      join("lib", "domain", "pacientes.ts"),
      join("lib", "domain", "plano-terapias.ts"),
    ]);
  });

  it("dentro de plano-terapias.ts, o get-or-create só é chamado uma vez (pelo cadastro)", () => {
    const fonte = readFileSync(join(raiz, "lib", "domain", "plano-terapias.ts"), "utf8");

    expect(fonte.match(/\bobterOuCriarPaciente\(/g)).toHaveLength(1);
    // A chamada mora na transação do cadastro, e só as duas portas
    // (`cadastrarPaciente` e a variante de teste) abrem essa transação.
    expect(fonte.match(/\bcadastrarNaTransacao\(/g)).toHaveLength(3);
  });

  it("o único chamador autorizado de criação de paciente é cadastrarPaciente, pela própria action", () => {
    expect(quemContem(/\bcadastrarPaciente\(/)).toEqual([
      join("lib", "domain", "plano-terapias-actions.ts"),
      join("lib", "domain", "plano-terapias.ts"), // a definição
    ]);
    // A variante de teste não tem chamador no código de aplicação.
    expect(quemContem(/\bcadastrarPacienteNaTransacao\(/)).toEqual([
      join("lib", "domain", "plano-terapias.ts"), // a definição
    ]);
    // E a action só é usada pela tela Cadastro.
    expect(quemContem(/\bcadastrarPacienteAction\b/)).toEqual([
      join("components", "cadastro-de-paciente", "tela-de-cadastro.tsx"),
      join("lib", "domain", "plano-terapias-actions.ts"),
    ]);
  });

  it("os dois encaminhamentos só procuram o paciente, sem criar", () => {
    expect(quemContem(/\bexigirPacienteDoConvenio\(/)).toEqual([
      join("lib", "domain", "autorizacoes-sulamerica.ts"),
      join("lib", "domain", "encaminhamentos.ts"),
      join("lib", "domain", "pacientes.ts"), // a definição
    ]);
  });

  it("nenhum outro arquivo insere em paciente", () => {
    expect(quemContem(/INSERT\s+INTO\s+"?paciente"?\s*\(/i)).toEqual([
      join("lib", "domain", "pacientes.ts"),
    ]);
    expect(quemContem(/\.paciente\.(create|createMany|upsert)\(/)).toEqual([]);
  });
});

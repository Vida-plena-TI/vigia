/**
 * Tempo semanal, convênio e validação do cadastro de paciente — sem banco.
 *
 * `plano-terapias.ts` importa o Prisma, mas `validarEntrada` não toca nele; o
 * dublê de `@/lib/db` só garante que nenhum teste daqui abre conexão.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  getPrismaClient: () => {
    throw new Error("teste unitario nao deveria abrir conexao");
  },
}));

import { CONVENIOS, ehConvenioValido } from "./convenio";
import {
  ERRO_CONVENIO_INVALIDO,
  ERRO_PACIENTE_OBRIGATORIO,
  ERRO_SEM_TERAPIA,
  ERRO_TEMPO_ACIMA_DO_LIMITE,
  ERRO_TEMPO_FORA_DO_PASSO,
  ERRO_TEMPO_INVALIDO,
  ERRO_TEMPO_NAO_POSITIVO,
  ERRO_TEMPO_OBRIGATORIO,
  ERRO_TERAPIA_OBRIGATORIA,
  ERRO_TERAPIA_REPETIDA,
  mensagemDeCadastro,
  validarEntrada,
} from "./plano-terapias";
import * as mensagens from "./plano-terapias-mensagens";
import {
  MINUTOS_SEMANAIS_MAXIMO,
  formatarMinutosSemanais,
  lerHorasSemanais,
} from "./tempo-semanal";

describe("lerHorasSemanais", () => {
  it.each([
    ["2", 120],
    ["2,5", 150],
    ["2.5", 150],
    ["0,25", 15],
    ["0.25", 15],
    ["0,5", 30],
    ["0,75", 45],
    ["1,50", 90],
    ["02", 120],
    ["  3  ", 180],
    ["167,75", 10065],
    ["168", 10080],
    ["168,0", 10080],
    ["168,00", 10080],
  ])("%j vira %i minutos", (texto, minutos) => {
    expect(lerHorasSemanais(texto)).toEqual({ ok: true, minutos });
  });

  it("168 h é exatamente o limite do CHECK", () => {
    expect(MINUTOS_SEMANAIS_MAXIMO).toBe(10080);
  });

  it.each([
    ["", ERRO_TEMPO_OBRIGATORIO],
    ["   ", ERRO_TEMPO_OBRIGATORIO],
    ["0", ERRO_TEMPO_NAO_POSITIVO],
    ["0,0", ERRO_TEMPO_NAO_POSITIVO],
    ["000", ERRO_TEMPO_NAO_POSITIVO],
    ["-2", ERRO_TEMPO_NAO_POSITIVO],
    ["-0,25", ERRO_TEMPO_NAO_POSITIVO],
    ["168,25", ERRO_TEMPO_ACIMA_DO_LIMITE],
    ["169", ERRO_TEMPO_ACIMA_DO_LIMITE],
    ["1000", ERRO_TEMPO_ACIMA_DO_LIMITE],
    ["99999999999999999999", ERRO_TEMPO_ACIMA_DO_LIMITE],
    ["0,1", ERRO_TEMPO_FORA_DO_PASSO],
    ["0,10", ERRO_TEMPO_FORA_DO_PASSO],
    ["1,3", ERRO_TEMPO_FORA_DO_PASSO],
    ["0,125", ERRO_TEMPO_FORA_DO_PASSO],
    ["2,333333", ERRO_TEMPO_FORA_DO_PASSO],
    ["duas", ERRO_TEMPO_INVALIDO],
    ["2h", ERRO_TEMPO_INVALIDO],
    ["2 h", ERRO_TEMPO_INVALIDO],
    ["1e2", ERRO_TEMPO_INVALIDO],
    ["2,", ERRO_TEMPO_INVALIDO],
    [",5", ERRO_TEMPO_INVALIDO],
    ["1,5,5", ERRO_TEMPO_INVALIDO],
    ["+2", ERRO_TEMPO_INVALIDO],
    ["0x10", ERRO_TEMPO_INVALIDO],
  ])("%j é recusado", (texto, erro) => {
    expect(lerHorasSemanais(texto)).toEqual({ ok: false, erro });
  });

  it("nenhuma mensagem repete o que foi digitado", () => {
    for (const texto of ["12345,678", "abcxyz", "-777", "999,25"]) {
      const resultado = lerHorasSemanais(texto);

      expect(resultado.ok).toBe(false);
      if (!resultado.ok) {
        expect(resultado.erro).not.toContain(texto);
      }
    }
  });
});

describe("formatarMinutosSemanais", () => {
  it.each([
    [120, "2 h"],
    [150, "2 h 30 min"],
    [45, "45 min"],
    [15, "15 min"],
    [60, "1 h"],
    [75, "1 h 15 min"],
    [10080, "168 h"],
  ])("%i → %j", (minutos, texto) => {
    expect(formatarMinutosSemanais(minutos)).toBe(texto);
  });

  it("formata de volta o que lerHorasSemanais converteu", () => {
    const lido = lerHorasSemanais("2,5");

    expect(lido.ok && formatarMinutosSemanais(lido.minutos)).toBe("2 h 30 min");
  });
});

describe("convênio", () => {
  it("espelha o CHECK paciente_convenio_valido", () => {
    expect(CONVENIOS).toEqual(["klini", "sulamerica"]);
  });

  it.each(["klini", "sulamerica"])("%j é válido", (valor) => {
    expect(ehConvenioValido(valor)).toBe(true);
  });

  it.each(["", "Klini", "SULAMERICA", "outro", null, undefined, 1])(
    "%j não é válido",
    (valor) => {
      expect(ehConvenioValido(valor)).toBe(false);
    },
  );
});

describe("validarEntrada do cadastro de paciente", () => {
  const base = {
    nome: "  Fulano de Tal  ",
    convenio: "klini",
    terapias: [
      { terapiaId: 1, horas: "2" },
      { terapiaId: 2, horas: "0,75" },
    ],
  };

  it("converte as horas e trima o nome", () => {
    expect(validarEntrada(base)).toEqual({
      ok: true,
      entrada: {
        nome: "Fulano de Tal",
        convenio: "klini",
        plano: [
          { terapiaId: 1, minutosSemanais: 120 },
          { terapiaId: 2, minutosSemanais: 45 },
        ],
      },
    });
  });

  it("nome vazio ou só espaço é recusado", () => {
    expect(validarEntrada({ ...base, nome: "   " })).toEqual({
      ok: false,
      erro: ERRO_PACIENTE_OBRIGATORIO,
    });
  });

  it.each(["", "Klini", "outro"])("convênio %j é recusado", (convenio) => {
    expect(validarEntrada({ ...base, convenio })).toEqual({
      ok: false,
      erro: ERRO_CONVENIO_INVALIDO,
    });
  });

  it("sem terapia é recusado", () => {
    expect(validarEntrada({ ...base, terapias: [] })).toEqual({
      ok: false,
      erro: ERRO_SEM_TERAPIA,
    });
  });

  it("terapia repetida aponta a segunda linha", () => {
    expect(
      validarEntrada({
        ...base,
        terapias: [
          { terapiaId: 1, horas: "2" },
          { terapiaId: 2, horas: "1" },
          { terapiaId: 1, horas: "3" },
        ],
      }),
    ).toEqual({ ok: false, erro: ERRO_TERAPIA_REPETIDA, linha: 2 });
  });

  it.each([0, -1, 1.5, Number.NaN])("terapiaId %j aponta a linha", (terapiaId) => {
    expect(
      validarEntrada({ ...base, terapias: [base.terapias[0], { terapiaId, horas: "1" }] }),
    ).toEqual({ ok: false, erro: ERRO_TERAPIA_OBRIGATORIA, linha: 1 });
  });

  it("tempo inválido aponta a linha com a mensagem do tempo", () => {
    expect(
      validarEntrada({ ...base, terapias: [base.terapias[0], { terapiaId: 2, horas: "0,1" }] }),
    ).toEqual({ ok: false, erro: ERRO_TEMPO_FORA_DO_PASSO, linha: 1 });
  });
});

describe("mensagens", () => {
  it("distinguem paciente novo de plano atualizado", () => {
    expect(mensagemDeCadastro("Ana", true)).toBe(
      "Paciente Ana cadastrado com o plano de terapias.",
    );
    expect(mensagemDeCadastro("Ana", false)).toBe(
      "Plano de terapias de Ana atualizado.",
    );
  });

  it("o módulo de mensagens não importa banco", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    for (const arquivo of ["plano-terapias-mensagens.ts", "tempo-semanal.ts", "convenio.ts"]) {
      const fonte = readFileSync(join(__dirname, arquivo), "utf8");

      expect(fonte).not.toMatch(/@\/lib\/db|generated\/prisma|server-only/);
    }

    expect(Object.keys(mensagens).length).toBeGreaterThan(0);
  });
});

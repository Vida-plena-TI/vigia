/**
 * A caixa "Tempo por semana" da aba Cadastro (30/10/2026): opções prontas,
 * "Outro" com horas inteiras + minutos, o padrão de 30 minutos e o texto em
 * horas que a linha envia. Sem banco, sem React.
 *
 * O servidor não mudou: o último bloco prova que `validarEntrada` continua
 * recusando o que a tela não deveria mandar.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  getPrismaClient: () => {
    throw new Error("teste unitario nao deveria abrir conexao");
  },
}));

import { validarEntrada } from "./plano-terapias";
import {
  ERRO_TEMPO_ACIMA_DO_LIMITE,
  ERRO_TEMPO_FORA_DO_PASSO,
  ERRO_TEMPO_INVALIDO,
  ERRO_TEMPO_NAO_POSITIVO,
  ERRO_TEMPO_OBRIGATORIO,
} from "./plano-terapias-mensagens";
import {
  estadoDoOutroVazio,
  estadoDoTempoPadrao,
  type EstadoDoTempo,
  horasParaEnvio,
  lerHorasSemanais,
  MINUTOS_DO_OUTRO,
  MINUTOS_PADRAO_DA_LINHA_NOVA,
  MINUTOS_SEMANAIS_MAXIMO,
  minutosDoEstado,
  OPCOES_DE_TEMPO_PRONTAS,
  opcaoDoTempo,
  PASSO_EM_MINUTOS,
  ROTULO_OUTRO_TEMPO,
} from "./tempo-semanal";

const outro = (horas: string, minutos: number): EstadoDoTempo => ({
  tipo: "outro",
  horas,
  minutos,
});

describe("opções da caixa", () => {
  it("são as cinco prontas, nesta ordem, com os minutos certos", () => {
    expect(OPCOES_DE_TEMPO_PRONTAS).toEqual([
      { minutos: 30, rotulo: "30 minutos" },
      { minutos: 60, rotulo: "1 hora" },
      { minutos: 90, rotulo: "1 hora e meia" },
      { minutos: 120, rotulo: "2 horas" },
      { minutos: 150, rotulo: "2 horas e meia" },
    ]);
    expect(ROTULO_OUTRO_TEMPO).toBe("Outro (digitar)");
    expect(MINUTOS_DO_OUTRO).toEqual([0, 15, 30, 45]);
  });

  it("o padrão da linha nova é 30 minutos, uma opção pronta", () => {
    expect(MINUTOS_PADRAO_DA_LINHA_NOVA).toBe(30);
    expect(estadoDoTempoPadrao()).toEqual({ tipo: "pronta", minutos: 30 });
    expect(horasParaEnvio(estadoDoTempoPadrao())).toBe("0,5");
  });

  it("escolher Outro começa com horas vazias e 0 minutos", () => {
    expect(estadoDoOutroVazio()).toEqual(outro("", 0));
  });
});

describe("opcaoDoTempo (minutos gravados → caixa)", () => {
  it.each([30, 60, 90, 120, 150])("%i min é a opção pronta", (minutos) => {
    expect(opcaoDoTempo(minutos)).toEqual({ tipo: "pronta", minutos });
  });

  it.each([
    [15, outro("0", 15)],
    [45, outro("0", 45)],
    [180, outro("3", 0)],
    [195, outro("3", 15)],
    [210, outro("3", 30)],
    [240, outro("4", 0)],
    [MINUTOS_SEMANAIS_MAXIMO, outro("168", 0)],
  ])("%i min é Outro com horas e minutos", (minutos, esperado) => {
    expect(opcaoDoTempo(minutos)).toEqual(esperado);
  });

  it("todo valor que o CHECK aceita volta igual: caixa → minutos → texto → servidor", () => {
    for (
      let minutos = PASSO_EM_MINUTOS;
      minutos <= MINUTOS_SEMANAIS_MAXIMO;
      minutos += PASSO_EM_MINUTOS
    ) {
      const estado = opcaoDoTempo(minutos);

      expect(minutosDoEstado(estado)).toEqual({ ok: true, minutos });
      expect(lerHorasSemanais(horasParaEnvio(estado))).toEqual({
        ok: true,
        minutos,
      });
    }
  });
});

describe("minutosDoEstado e horasParaEnvio", () => {
  it.each([
    [30, "0,5"],
    [60, "1"],
    [90, "1,5"],
    [120, "2"],
    [150, "2,5"],
  ])("opção pronta de %i min envia %j", (minutos, texto) => {
    const estado: EstadoDoTempo = { tipo: "pronta", minutos };

    expect(minutosDoEstado(estado)).toEqual({ ok: true, minutos });
    expect(horasParaEnvio(estado)).toBe(texto);
  });

  it.each([
    [outro("0", 15), 15, "0,25"],
    [outro("0", 45), 45, "0,75"],
    [outro("3", 15), 195, "3,25"],
    [outro("3", 30), 210, "3,5"],
    [outro("4", 0), 240, "4"],
    [outro(" 4 ", 0), 240, "4"],
    [outro("007", 0), 420, "7"],
    [outro("168", 0), MINUTOS_SEMANAIS_MAXIMO, "168"],
  ])("Outro %j → %i min, envia %j", (estado, minutos, texto) => {
    expect(minutosDoEstado(estado)).toEqual({ ok: true, minutos });
    expect(horasParaEnvio(estado)).toBe(texto);
  });

  it.each([
    [outro("", 0), ERRO_TEMPO_OBRIGATORIO],
    [outro("", 30), ERRO_TEMPO_OBRIGATORIO],
    [outro("   ", 0), ERRO_TEMPO_OBRIGATORIO],
    [outro("0", 0), ERRO_TEMPO_NAO_POSITIVO],
    [outro("168", 15), ERRO_TEMPO_ACIMA_DO_LIMITE],
    [outro("169", 0), ERRO_TEMPO_ACIMA_DO_LIMITE],
    [outro("9999", 0), ERRO_TEMPO_ACIMA_DO_LIMITE],
    // Sem vírgula nem decimal: as horas do Outro são inteiras.
    [outro("1,5", 0), ERRO_TEMPO_INVALIDO],
    [outro("1.5", 0), ERRO_TEMPO_INVALIDO],
    [outro("-1", 0), ERRO_TEMPO_INVALIDO],
    [outro("dois", 0), ERRO_TEMPO_INVALIDO],
    [outro("1", 10), ERRO_TEMPO_FORA_DO_PASSO],
    [{ tipo: "pronta", minutos: 0 } as const, ERRO_TEMPO_NAO_POSITIVO],
    [{ tipo: "pronta", minutos: 20 } as const, ERRO_TEMPO_FORA_DO_PASSO],
    [{ tipo: "pronta", minutos: Number.NaN } as const, ERRO_TEMPO_INVALIDO],
  ])("%j é recusado e envia vazio", (estado, erro) => {
    expect(minutosDoEstado(estado)).toEqual({ ok: false, erro });
    expect(horasParaEnvio(estado)).toBe("");
  });
});

describe("o servidor continua a autoridade", () => {
  const linha = (horas: string) => ({
    nome: "Fulano",
    convenio: "klini",
    terapias: [{ terapiaId: 1, horas }],
  });

  it.each([
    ["", ERRO_TEMPO_OBRIGATORIO],
    ["0", ERRO_TEMPO_NAO_POSITIVO],
    ["0,1", ERRO_TEMPO_FORA_DO_PASSO],
    ["3,2", ERRO_TEMPO_FORA_DO_PASSO],
    ["168,25", ERRO_TEMPO_ACIMA_DO_LIMITE],
    ["200", ERRO_TEMPO_ACIMA_DO_LIMITE],
    ["30", undefined],
    ["outro", ERRO_TEMPO_INVALIDO],
  ])("horas %j vindas da tela", (horas, erro) => {
    const resultado = validarEntrada(linha(horas));

    if (erro === undefined) {
      // "30" é aceito como 30 horas, não 30 minutos: a tela nunca manda
      // minutos crus, manda o texto em horas de horasParaEnvio.
      expect(resultado).toMatchObject({
        ok: true,
        entrada: { plano: [{ terapiaId: 1, minutosSemanais: 1800 }] },
      });
      return;
    }

    expect(resultado).toEqual({ ok: false, erro, linha: 0 });
  });

  it("o que a tela envia para Outro 3 h 15 min o servidor grava como 195", () => {
    expect(validarEntrada(linha(horasParaEnvio(outro("3", 15))))).toMatchObject({
      ok: true,
      entrada: { plano: [{ terapiaId: 1, minutosSemanais: 195 }] },
    });
  });
});

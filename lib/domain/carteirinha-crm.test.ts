/**
 * Normalização e validação da carteirinha e do CRM, sem banco.
 *
 * Os limites de tamanho são testados dos dois lados de cada fronteira (4/5 e
 * 25/26 na carteirinha; 0/1 e 10/11 no CRM). Que o **banco** recusa o mesmo
 * que estas funções recusam — o CHECK da migration — é prova de
 * `carteirinha-crm.integration.test.ts`; aqui só se prova o espelho.
 *
 * Todos os valores são sintéticos.
 */
import { describe, expect, it } from "vitest";

import {
  ERRO_CARTEIRINHA_INVALIDA,
  ERRO_CARTEIRINHA_OBRIGATORIA,
  ERRO_CRM_INVALIDO,
  ERRO_CRM_OBRIGATORIO,
  ehErroDaCarteirinha,
  ehErroDoCrm,
  erroCarteirinhaDeOutroPaciente,
  ERRO_CARTEIRINHA_JA_CADASTRADA,
  normalizarCarteirinha,
  normalizarCrm,
  validarCarteirinha,
  validarCrm,
} from "./carteirinha-crm";

describe("validarCarteirinha", () => {
  it.each([
    ["5 caracteres (mínimo)", "A1B2C"],
    ["25 caracteres (máximo)", "A".repeat(12) + "1".repeat(13)],
    ["só dígitos", "0001234567890"],
    ["só letras", "ABCDEF"],
    ["caixa misturada, gravada como veio", "aBc12XyZ"],
  ])("aceita %s", (_rotulo, valor) => {
    expect(validarCarteirinha(valor)).toEqual({ ok: true, valor });
  });

  it.each([
    ["4 caracteres", "A1B2"],
    ["26 caracteres", "A".repeat(13) + "1".repeat(13)],
    ["hífen", "1234-5678"],
    ["ponto", "1234.5678"],
    ["barra", "1234/5678"],
    ["letra acentuada", "ÇABC1234"],
    ["dígito não ASCII", "١٢٣٤٥٦"],
  ])("recusa %s", (_rotulo, valor) => {
    expect(validarCarteirinha(valor)).toEqual({
      ok: false,
      erro: ERRO_CARTEIRINHA_INVALIDA,
    });
  });

  it.each([
    ["vazia", ""],
    ["só espaços", "   "],
    ["só quebra de linha e tab", "\n\t"],
  ])("exige preenchimento (%s)", (_rotulo, valor) => {
    expect(validarCarteirinha(valor)).toEqual({
      ok: false,
      erro: ERRO_CARTEIRINHA_OBRIGATORIA,
    });
  });

  it("tira espaço das pontas e do meio antes de validar", () => {
    expect(validarCarteirinha("  1234 5678 9012  ")).toEqual({
      ok: true,
      valor: "123456789012",
    });
  });

  it("conta o tamanho depois de tirar os espaços", () => {
    // 25 caracteres úteis com espaços no meio: passa.
    expect(validarCarteirinha("ABCDE FGHIJ KLMNO PQRST 12345")).toEqual({
      ok: true,
      valor: "ABCDEFGHIJKLMNOPQRST12345",
    });
    // 4 úteis com espaço sobrando: não vira 5.
    expect(validarCarteirinha(" AB 12 ")).toEqual({
      ok: false,
      erro: ERRO_CARTEIRINHA_INVALIDA,
    });
  });
});

describe("validarCrm", () => {
  it.each([
    ["1 dígito (mínimo)", "7"],
    ["10 dígitos (máximo)", "1234567890"],
    ["zero à esquerda, preservado", "0012345"],
  ])("aceita %s", (_rotulo, valor) => {
    expect(validarCrm(valor)).toEqual({ ok: true, valor });
  });

  it.each([
    ["11 dígitos", "12345678901"],
    ["letra", "12345A"],
    ["UF junto", "123456SP"],
    ["prefixo CRM/UF", "CRM/SP 123456"],
    ["hífen", "123-456"],
    ["vírgula", "123,456"],
  ])("recusa %s", (_rotulo, valor) => {
    expect(validarCrm(valor)).toEqual({ ok: false, erro: ERRO_CRM_INVALIDO });
  });

  it.each([
    ["vazio (0 dígitos)", ""],
    ["só espaços", "   "],
    ["só pontos", "..."],
  ])("exige preenchimento (%s)", (_rotulo, valor) => {
    expect(validarCrm(valor)).toEqual({
      ok: false,
      erro: ERRO_CRM_OBRIGATORIO,
    });
  });

  it("tira pontos e espaços antes de validar", () => {
    expect(validarCrm(" 123.456 ")).toEqual({ ok: true, valor: "123456" });
    expect(validarCrm("1 234 567")).toEqual({ ok: true, valor: "1234567" });
  });

  it("conta o tamanho depois de tirar os pontos", () => {
    // "1.234.567.890" tem 13 caracteres e 10 dígitos: passa.
    expect(validarCrm("1.234.567.890")).toEqual({
      ok: true,
      valor: "1234567890",
    });
    expect(validarCrm("12.345.678.901")).toEqual({
      ok: false,
      erro: ERRO_CRM_INVALIDO,
    });
  });
});

describe("normalização", () => {
  it("carteirinha não mexe em caixa nem em símbolo", () => {
    expect(normalizarCarteirinha(" ab-12 ")).toBe("ab-12");
  });

  it("CRM não tira hífen nem barra (só ponto e espaço)", () => {
    expect(normalizarCrm(" 12.3-4/5 ")).toBe("123-4/5");
  });
});

describe("mensagens", () => {
  it("nenhuma mensagem de formato repete o valor digitado", () => {
    // O contrário seria pôr dado de paciente em texto que pode parar em log
    // ou em print de tela.
    const valor = "ZZ9988776655";

    for (const resultado of [
      validarCarteirinha(`${valor}-`),
      validarCrm(`${valor}`),
    ]) {
      expect(resultado.ok).toBe(false);
      if (!resultado.ok) {
        expect(resultado.erro).not.toContain(valor);
      }
    }
  });

  it("a recusa por dono cita o nome, não a carteirinha", () => {
    expect(erroCarteirinhaDeOutroPaciente("Fulana de Teste")).toBe(
      "Esta carteirinha já está cadastrada para Fulana de Teste.",
    );
  });

  it("separa os erros por campo, para o formulário marcar o certo", () => {
    for (const mensagem of [
      ERRO_CARTEIRINHA_OBRIGATORIA,
      ERRO_CARTEIRINHA_INVALIDA,
      ERRO_CARTEIRINHA_JA_CADASTRADA,
      erroCarteirinhaDeOutroPaciente("Fulana de Teste"),
    ]) {
      expect(ehErroDaCarteirinha(mensagem)).toBe(true);
      expect(ehErroDoCrm(mensagem)).toBe(false);
    }

    for (const mensagem of [ERRO_CRM_OBRIGATORIO, ERRO_CRM_INVALIDO]) {
      expect(ehErroDoCrm(mensagem)).toBe(true);
      expect(ehErroDaCarteirinha(mensagem)).toBe(false);
    }

    expect(ehErroDaCarteirinha(undefined)).toBe(false);
    expect(ehErroDoCrm(undefined)).toBe(false);
  });
});

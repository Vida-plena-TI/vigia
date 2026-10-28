import { describe, expect, it } from "vitest";

import {
  ERRO_NOME_MEDICO_INVALIDO,
  ERRO_NOME_MEDICO_OBRIGATORIO,
  ehErroDoNomeMedico,
  validarNomeMedico,
} from "./nome-medico";

describe("nome do médico", () => {
  it.each(["", "   ", "\t\n", "  "])("vazio ou só espaço (%j) é obrigatório", (texto) => {
    expect(validarNomeMedico(texto)).toEqual({ ok: false, erro: ERRO_NOME_MEDICO_OBRIGATORIO });
  });

  it.each([undefined, null, 42])("tipo errado (%j) vindo de POST direto é obrigatório", (texto) => {
    expect(validarNomeMedico(texto)).toEqual({ ok: false, erro: ERRO_NOME_MEDICO_OBRIGATORIO });
  });

  it.each([
    ["2 caracteres", "Jo"],
    ["2 caracteres com espaço nas pontas", "  Jo  "],
    ["121 caracteres", "a".repeat(121)],
    ["só dígitos", "123456"],
    ["só pontuação", "..-''"],
    ["caractere de controle", "Dr. Jo\u0007ão"],
    ["caractere invisível de formatação", "Dr. Jo​ão"],
  ])("recusa %s", (_caso, texto) => {
    expect(validarNomeMedico(texto)).toEqual({ ok: false, erro: ERRO_NOME_MEDICO_INVALIDO });
  });

  it("aceita 3 e 120 caracteres", () => {
    expect(validarNomeMedico("Ana")).toEqual({ ok: true, valor: "Ana" });
    expect(validarNomeMedico("a".repeat(120))).toMatchObject({ ok: true });
  });

  it("conta pontos de código, não unidades UTF-16 (acento combinado ou não)", () => {
    expect(validarNomeMedico("Zoé")).toEqual({ ok: true, valor: "Zoé" });
    expect(validarNomeMedico("é".repeat(120))).toMatchObject({ ok: true });
  });

  it("aceita acento, ponto, apóstrofo e hífen, e normaliza os espaços", () => {
    expect(validarNomeMedico("  Dr.   João\tD'Ávila-Silva  ")).toEqual({
      ok: true,
      valor: "Dr. João D'Ávila-Silva",
    });
  });

  it("não padroniza caixa", () => {
    expect(validarNomeMedico("dra. MARIA da silva")).toEqual({ ok: true, valor: "dra. MARIA da silva" });
  });

  it("a mensagem de erro não repete o que foi digitado", () => {
    const digitado = "Xq";
    const resultado = validarNomeMedico(digitado);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erro).not.toContain(digitado);
  });

  it("reconhece as próprias mensagens para marcar o campo", () => {
    expect(ehErroDoNomeMedico(ERRO_NOME_MEDICO_OBRIGATORIO)).toBe(true);
    expect(ehErroDoNomeMedico(ERRO_NOME_MEDICO_INVALIDO)).toBe(true);
    expect(ehErroDoNomeMedico("Informe o CRM do médico.")).toBe(false);
  });
});

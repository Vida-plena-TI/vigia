/**
 * Testes da validação de entrada e da confirmação do cadastro.
 *
 * O que **não** está aqui é a parte mais importante: não existe teste do
 * cálculo de vencimento nem da classificação por mês em TypeScript, porque
 * nenhum dos dois existe em TypeScript. Os 180 dias corridos são
 * responsabilidade da coluna gerada e a comparação de meses é da view
 * `encaminhamento_status`; quem prova que as duas acertam — inclusive nas
 * fronteiras de mês — é `encaminhamentos.integration.test.ts`. Um espelho
 * dessas fórmulas aqui só provaria que duas cópias do mesmo erro concordam.
 */
import { describe, expect, it } from "vitest";

import {
  ERRO_DATA_INVALIDA,
  ERRO_DATA_OBRIGATORIA,
  ERRO_PACIENTE_OBRIGATORIO,
  contarPorStatusDeEncaminhamento,
  mensagemDeCadastro,
  validarEntrada,
  type EncaminhamentoNaLista,
} from "./encaminhamentos";

describe("validarEntrada", () => {
  it("aceita paciente e data preenchidos", () => {
    expect(
      validarEntrada({
        pacienteNome: "Ana Beatriz Moraes",
        dataEncaminhamento: "2026-11-15",
      }),
    ).toEqual({ ok: true });
  });

  it("aceita nome e data com espaço sobrando (o trim é de quem grava)", () => {
    expect(
      validarEntrada({
        pacienteNome: "  Ana Beatriz Moraes  ",
        dataEncaminhamento: "  2026-11-15  ",
      }),
    ).toEqual({ ok: true });
  });

  it("recusa paciente vazio", () => {
    expect(
      validarEntrada({ pacienteNome: "   ", dataEncaminhamento: "2026-11-15" }),
    ).toEqual({ ok: false, erro: ERRO_PACIENTE_OBRIGATORIO });
  });

  it("recusa data vazia", () => {
    expect(
      validarEntrada({ pacienteNome: "Ana", dataEncaminhamento: "" }),
    ).toEqual({ ok: false, erro: ERRO_DATA_OBRIGATORIA });
  });

  it("recusa data fora do formato AAAA-MM-DD", () => {
    expect(
      validarEntrada({ pacienteNome: "Ana", dataEncaminhamento: "15/11/2026" }),
    ).toEqual({ ok: false, erro: ERRO_DATA_INVALIDA });
  });

  it("recusa data que não existe no calendário", () => {
    // `new Date("2026-02-31")` normalizaria para 03/03 em silêncio; o formato
    // sozinho não basta.
    expect(
      validarEntrada({ pacienteNome: "Ana", dataEncaminhamento: "2026-02-31" }),
    ).toEqual({ ok: false, erro: ERRO_DATA_INVALIDA });

    // 2026 não é bissexto.
    expect(
      validarEntrada({ pacienteNome: "Ana", dataEncaminhamento: "2026-02-29" }),
    ).toEqual({ ok: false, erro: ERRO_DATA_INVALIDA });
  });

  it("aceita 29 de fevereiro em ano bissexto", () => {
    expect(
      validarEntrada({ pacienteNome: "Ana", dataEncaminhamento: "2028-02-29" }),
    ).toEqual({ ok: true });
  });

  it("recusa mês e dia fora de faixa", () => {
    for (const dataEncaminhamento of ["2026-13-01", "2026-00-10", "2026-11-32"]) {
      expect(validarEntrada({ pacienteNome: "Ana", dataEncaminhamento })).toEqual(
        { ok: false, erro: ERRO_DATA_INVALIDA },
      );
    }
  });
});

describe("mensagemDeCadastro", () => {
  // Um paciente tem no máximo um encaminhamento: o segundo cadastro apaga o
  // primeiro. As duas palavras precisam ser diferentes porque os dois eventos
  // são diferentes — sem isso, a linha antiga sumindo da lista pareceria bug.
  it("diz \"cadastrado\" quando não havia encaminhamento antes", () => {
    expect(mensagemDeCadastro("Ana Beatriz Moraes", false)).toBe(
      "Encaminhamento cadastrado para Ana Beatriz Moraes.",
    );
  });

  it("diz \"atualizado\" quando substituiu o anterior", () => {
    expect(mensagemDeCadastro("Ana Beatriz Moraes", true)).toBe(
      "Encaminhamento atualizado para Ana Beatriz Moraes.",
    );
  });
});

describe("contarPorStatusDeEncaminhamento", () => {
  /** Uma linha de listagem só com o que a contagem olha. */
  function linha(
    statusEncaminhamento: EncaminhamentoNaLista["statusEncaminhamento"],
    id: number,
  ): EncaminhamentoNaLista {
    return {
      id,
      pacienteNome: `Paciente ${id}`,
      dataEncaminhamento: "2026-01-01",
      dataVencimento: "2026-06-30",
      statusEncaminhamento,
    };
  }

  it("conta cada status separadamente", () => {
    expect(
      contarPorStatusDeEncaminhamento([
        linha("Vencido", 1),
        linha("Vence este mês", 2),
        linha("Vence este mês", 3),
        linha("A vencer", 4),
      ]),
    ).toEqual({ Vencido: 1, "Vence este mês": 2, "A vencer": 1 });
  });

  it("ignora quem não tem status (vencimento a dois ou mais meses)", () => {
    // Ausência de status não é um quarto contador: a linha simplesmente não
    // pede atenção, na tabela nem no resumo.
    expect(
      contarPorStatusDeEncaminhamento([
        linha(null, 1),
        linha(null, 2),
        linha("Vencido", 3),
      ]),
    ).toEqual({ Vencido: 1, "Vence este mês": 0, "A vencer": 0 });
  });

  it("devolve os três zerados para lista vazia", () => {
    expect(contarPorStatusDeEncaminhamento([])).toEqual({
      Vencido: 0,
      "Vence este mês": 0,
      "A vencer": 0,
    });
  });
});

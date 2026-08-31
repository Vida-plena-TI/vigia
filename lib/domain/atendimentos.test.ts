/**
 * Testes da validação do lote de atendimento (regra 7 do CONTEXT.md, itens
 * "lote vazio", "id duplicado" e "créditos inteiro > 0").
 *
 * `validarLote` é pura de propósito: as três recusas que não dependem do banco
 * são justamente as que precisam ser rápidas e testáveis sem Postgres. As
 * recusas que dependem do banco (guia inexistente, saldo insuficiente,
 * concorrência) estão em `atendimentos.integration.test.ts`.
 */
import { describe, expect, it } from "vitest";

import {
  ERRO_ATENDIMENTO_ID_INVALIDO,
  ERRO_CREDITOS_EDICAO_INVALIDOS,
  ERRO_CREDITOS_INVALIDOS,
  ERRO_DATA_INVALIDA,
  ERRO_GUIA_DUPLICADA,
  ERRO_GUIA_INVALIDA,
  ERRO_PACIENTE_OBRIGATORIO,
  ERRO_SEM_SELECAO,
  validarEdicaoDeAtendimento,
  validarLote,
  type EntradaDeEdicaoDeAtendimento,
  type EntradaDeLote,
  type ItemDoLote,
} from "./atendimentos";

/** Um lote válido, para cada teste estragar só o campo que lhe interessa. */
function lote(alteracoes: Partial<EntradaDeLote> = {}): EntradaDeLote {
  return {
    pacienteId: 1,
    dataAtendimento: "2026-08-31",
    observacao: null,
    itens: [{ requisicaoTerapiaId: 10, creditosConsumidos: 1 }],
    ...alteracoes,
  };
}

/** Atalho para montar itens sem repetir os nomes dos campos. */
function item(id: number, creditos: number): ItemDoLote {
  return { requisicaoTerapiaId: id, creditosConsumidos: creditos };
}

describe("validarLote", () => {
  it("aceita um lote bem formado", () => {
    expect(validarLote(lote())).toEqual({ ok: true });
  });

  it("aceita várias terapias diferentes no mesmo lote", () => {
    const resultado = validarLote(
      lote({ itens: [item(10, 1), item(11, 2), item(12, 3)] }),
    );

    expect(resultado).toEqual({ ok: true });
  });

  it("recusa lote sem nenhuma terapia selecionada", () => {
    expect(validarLote(lote({ itens: [] }))).toEqual({
      ok: false,
      erro: ERRO_SEM_SELECAO,
    });
  });

  it("recusa a mesma guia repetida no lote, apontando a segunda ocorrência", () => {
    const resultado = validarLote(
      lote({ itens: [item(10, 1), item(11, 1), item(10, 1)] }),
    );

    expect(resultado).toEqual({
      ok: false,
      erro: ERRO_GUIA_DUPLICADA,
      item: 2,
    });
  });

  // A duplicata é recusada mesmo quando cada metade caberia sozinha no saldo:
  // as duas passariam pela checagem com o mesmo saldo de partida e juntas
  // estourariam a autorização.
  it("recusa a duplicata antes de olhar os créditos", () => {
    const resultado = validarLote(lote({ itens: [item(10, 1), item(10, 1)] }));

    expect(resultado).toMatchObject({ ok: false, erro: ERRO_GUIA_DUPLICADA });
  });

  it.each([
    ["zero", 0],
    ["negativo", -1],
    ["fracionário", 1.5],
    ["NaN (veio texto que não era inteiro)", Number.NaN],
  ])("recusa créditos %s", (_rotulo, creditos) => {
    const resultado = validarLote(lote({ itens: [item(10, creditos)] }));

    expect(resultado).toEqual({
      ok: false,
      erro: ERRO_CREDITOS_INVALIDOS,
      item: 0,
    });
  });

  it("aponta o índice da terapia com créditos inválidos", () => {
    const resultado = validarLote(
      lote({ itens: [item(10, 1), item(11, 0), item(12, 1)] }),
    );

    expect(resultado).toEqual({
      ok: false,
      erro: ERRO_CREDITOS_INVALIDOS,
      item: 1,
    });
  });

  it.each([
    ["zero", 0],
    ["negativo", -3],
    ["fracionário", 1.5],
    ["NaN", Number.NaN],
  ])("recusa id de guia %s", (_rotulo, id) => {
    const resultado = validarLote(lote({ itens: [item(id, 1)] }));

    expect(resultado).toEqual({
      ok: false,
      erro: ERRO_GUIA_INVALIDA,
      item: 0,
    });
  });

  it.each([
    ["vazia", ""],
    ["no formato brasileiro", "31/08/2026"],
    ["com dia que não existe", "2026-02-31"],
    ["com mês fora da faixa", "2026-13-01"],
    ["com hora junto", "2026-08-31T10:00:00"],
  ])("recusa data %s", (_rotulo, data) => {
    expect(validarLote(lote({ dataAtendimento: data }))).toEqual({
      ok: false,
      erro: ERRO_DATA_INVALIDA,
    });
  });

  it("aceita 29 de fevereiro em ano bissexto", () => {
    expect(validarLote(lote({ dataAtendimento: "2028-02-29" }))).toEqual({
      ok: true,
    });
  });

  it.each([
    ["zero", 0],
    ["negativo", -1],
    ["NaN", Number.NaN],
  ])("recusa paciente %s", (_rotulo, pacienteId) => {
    expect(validarLote(lote({ pacienteId }))).toEqual({
      ok: false,
      erro: ERRO_PACIENTE_OBRIGATORIO,
    });
  });
});

function edicao(
  alteracoes: Partial<EntradaDeEdicaoDeAtendimento> = {},
): EntradaDeEdicaoDeAtendimento {
  return {
    atendimentoId: 1,
    dataAtendimento: "2026-08-31",
    creditosConsumidos: 1,
    observacao: null,
    ...alteracoes,
  };
}

describe("validarEdicaoDeAtendimento", () => {
  it("aceita edição para zero créditos", () => {
    expect(
      validarEdicaoDeAtendimento(edicao({ creditosConsumidos: 0 })),
    ).toEqual({ ok: true });
  });

  it.each([
    ["negativo", -1],
    ["fracionário", 1.5],
    ["NaN", Number.NaN],
  ])("recusa créditos %s", (_rotulo, creditosConsumidos) => {
    expect(
      validarEdicaoDeAtendimento(edicao({ creditosConsumidos })),
    ).toEqual({
      ok: false,
      erro: ERRO_CREDITOS_EDICAO_INVALIDOS,
    });
  });

  it.each([0, -1, 1.5, Number.NaN])(
    "recusa atendimento com id inválido %p",
    (atendimentoId) => {
      expect(validarEdicaoDeAtendimento(edicao({ atendimentoId }))).toEqual({
        ok: false,
        erro: ERRO_ATENDIMENTO_ID_INVALIDO,
      });
    },
  );

  it("recusa data inválida", () => {
    expect(
      validarEdicaoDeAtendimento(edicao({ dataAtendimento: "2026-02-31" })),
    ).toEqual({
      ok: false,
      erro: ERRO_DATA_INVALIDA,
    });
  });
});

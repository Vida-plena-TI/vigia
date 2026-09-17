import { describe, expect, it } from "vitest";
import { contarPorStatusDeAutorizacao, validarEntrada, type AutorizacaoNaLista } from "./autorizacoes-sulamerica";
import { fraseDeExclusao } from "./pacientes-mensagens";

const entrada = { pacienteNome: "Maria", dataInicio: "2026-01-31", prazoMeses: 3 };
describe("validação de autorização SulAmérica", () => {
  it.each([3, 6, 12])("aceita prazo %i", prazoMeses => {
    expect(validarEntrada({ ...entrada, prazoMeses })).toEqual({ ok: true });
  });
  it.each([0, 1, 4, 9, 24, -3, 3.5, NaN])("recusa prazo %s", prazoMeses => {
    expect(validarEntrada({ ...entrada, prazoMeses }).ok).toBe(false);
  });
  it.each(["", "2026-02-29", "2026-04-31", "2026-13-01", "0000-01-01", "31/01/2026"])("recusa data %s", dataInicio => {
    expect(validarEntrada({ ...entrada, dataInicio }).ok).toBe(false);
  });
  it("recusa paciente vazio", () => {
    expect(validarEntrada({ ...entrada, pacienteNome: "  " }).ok).toBe(false);
  });
  it("conta os rótulos da view, sem incluir a ausência de marcação", () => {
    const linhas = ["Vencido", "Vencido", "Vence este mês", "A vencer", null].map(statusAutorizacao =>
      ({ statusAutorizacao }) as AutorizacaoNaLista);
    expect(contarPorStatusDeAutorizacao(linhas)).toEqual({ Vencido: 2, "Vence este mês": 1, "A vencer": 1 });
  });
  it("confirmação de exclusão completa avisa sobre autorização compartilhada", () => {
    expect(fraseDeExclusao("Maria", 1, 2, true)).toContain("A autorização SulAmérica também será apagada.");
    expect(fraseDeExclusao("Maria", 1, 2, false)).not.toContain("SulAmérica");
  });
});

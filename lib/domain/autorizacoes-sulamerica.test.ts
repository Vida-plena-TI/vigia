import { describe, expect, it, vi } from "vitest";

// Só `listarAutorizacoes`/`listarEncaminhamentosSulamerica` falam com o banco aqui.
const linhaDoBanco = {
  id: 1, pacienteId: 2, pacienteNome: "Maria", dataInicio: "2026-01-31", prazoMeses: 3,
  dataVencimento: "2026-04-30", statusAutorizacao: null,
  numeroCarteirinha: "SENTINELA12345", crmMedico: "8765432109", nomeMedico: "Dra. Sentinela",
};
vi.mock("@/lib/db", () => ({ getPrismaClient: () => ({ $queryRaw: async () => [linhaDoBanco] }) }));

import {
  contarPorStatusDeAutorizacao, listarAutorizacoes, listarEncaminhamentosSulamerica, validarEntrada,
  type AutorizacaoNaLista,
} from "./autorizacoes-sulamerica";
import { ERRO_PRAZO_INVALIDO } from "./autorizacoes-sulamerica-mensagens";
import {
  ERRO_CARTEIRINHA_INVALIDA, ERRO_CRM_INVALIDO, ERRO_CRM_OBRIGATORIO,
} from "./carteirinha-crm";
import { ERRO_NOME_MEDICO_INVALIDO, ERRO_NOME_MEDICO_OBRIGATORIO } from "./nome-medico";
import { fraseDeExclusao } from "./pacientes-mensagens";

const entrada = {
  pacienteNome: "Maria", dataInicio: "2026-01-31", prazoMeses: 3,
  numeroCarteirinha: "TESTE12345", crmMedico: "123456", nomeMedico: "Dra. Teste",
};
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
  it.each([0, 1, 4, 24, NaN])("prazo %s recusado com a frase do prazo", prazoMeses => {
    expect(validarEntrada({ ...entrada, prazoMeses })).toEqual({ ok: false, erro: ERRO_PRAZO_INVALIDO });
  });
  it("carteirinha vazia passa aqui (quem decide é a transação); mal formada não", () => {
    expect(validarEntrada({ ...entrada, numeroCarteirinha: "  " })).toEqual({ ok: true });
    expect(validarEntrada({ ...entrada, numeroCarteirinha: "AB-1" })).toEqual({ ok: false, erro: ERRO_CARTEIRINHA_INVALIDA });
  });
  it("CRM é sempre obrigatório", () => {
    expect(validarEntrada({ ...entrada, crmMedico: " " })).toEqual({ ok: false, erro: ERRO_CRM_OBRIGATORIO });
    expect(validarEntrada({ ...entrada, crmMedico: "CRM/SP 1" })).toEqual({ ok: false, erro: ERRO_CRM_INVALIDO });
  });
  it.each([
    ["", ERRO_NOME_MEDICO_OBRIGATORIO], ["   ", ERRO_NOME_MEDICO_OBRIGATORIO],
    ["Jo", ERRO_NOME_MEDICO_INVALIDO], ["a".repeat(121), ERRO_NOME_MEDICO_INVALIDO],
    ["12345", ERRO_NOME_MEDICO_INVALIDO],
  ])("nome do médico %j é recusado", (nomeMedico, erro) => {
    expect(validarEntrada({ ...entrada, nomeMedico })).toEqual({ ok: false, erro });
  });
  it("nome do médico ausente em POST direto é recusado", () => {
    const semMedico = { ...entrada, nomeMedico: undefined } as unknown as typeof entrada;
    expect(validarEntrada(semMedico)).toEqual({ ok: false, erro: ERRO_NOME_MEDICO_OBRIGATORIO });
  });
  it("as mensagens não repetem carteirinha, CRM nem nome do médico digitados", () => {
    for (const campo of [
      { numeroCarteirinha: "AB-12345" }, { crmMedico: "12.34-5" }, { nomeMedico: "99999" },
    ]) {
      const resultado = validarEntrada({ ...entrada, ...campo });
      expect(resultado.ok).toBe(false);
      if (!resultado.ok) expect(resultado.erro).not.toContain(Object.values(campo)[0]);
    }
  });
  it("recusa paciente vazio", () => {
    expect(validarEntrada({ ...entrada, pacienteNome: "  " }).ok).toBe(false);
  });
  it("a lista do painel não carrega carteirinha, CRM nem médico; a da aba Encaminhamentos sim", async () => {
    const painel = await listarAutorizacoes();
    expect(painel).toHaveLength(1);
    expect(JSON.stringify(painel)).not.toMatch(/SENTINELA12345|8765432109|Sentinela/);
    expect(await listarEncaminhamentosSulamerica()).toEqual([linhaDoBanco]);
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

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GuiaDoDashboard, PacienteComGuias } from "@/lib/domain/guias";

const mocks = vi.hoisted(() => ({
  agruparPorPaciente: vi.fn(),
  listarGuiasDoDashboard: vi.fn(),
}));

vi.mock("@/lib/domain/guias", () => ({
  agruparPorPaciente: mocks.agruparPorPaciente,
  listarGuiasDoDashboard: mocks.listarGuiasDoDashboard,
}));

import {
  filtrarPacientesComGuiasEmAlerta,
  guiaDisparaRelatorio,
  montarRelatorioSemanal,
} from "./montar";

function guia(alteracoes: Partial<GuiaDoDashboard>): GuiaDoDashboard {
  return {
    id: 1,
    pacienteId: 1,
    pacienteNome: "Ana",
    requisicaoId: 1,
    numeroRequisicao: "REQ-1",
    terapiaId: 1,
    terapiaNome: "Fonoaudiologia",
    codigoTiss: "123",
    qtdAutorizada: 8,
    qtdUtilizada: 0,
    saldoRestante: 8,
    validade: null,
    statusAlerta: "Regular",
    ...alteracoes,
  };
}

function paciente(
  id: number,
  nome: string,
  guias: GuiaDoDashboard[],
): PacienteComGuias {
  return { id, nome, guias };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("montarRelatorioSemanal", () => {
  it("reaproveita a query e o agrupamento do dashboard", async () => {
    const guias = [guia({ id: 10, statusAlerta: "Renovar" })];
    const agrupados = [paciente(1, "Ana", guias)];

    mocks.listarGuiasDoDashboard.mockResolvedValue(guias);
    mocks.agruparPorPaciente.mockReturnValue(agrupados);

    await expect(montarRelatorioSemanal()).resolves.toEqual(agrupados);
    expect(mocks.listarGuiasDoDashboard).toHaveBeenCalledTimes(1);
    expect(mocks.agruparPorPaciente).toHaveBeenCalledWith(guias);
  });

  it("mantém só pacientes com guia Renovar ou Esgotada", () => {
    const regular = guia({
      id: 1,
      pacienteId: 1,
      pacienteNome: "Ana",
      statusAlerta: "Regular",
    });
    const renovar = guia({
      id: 2,
      pacienteId: 2,
      pacienteNome: "Bia",
      statusAlerta: "Renovar",
    });
    const regularDoMesmoPaciente = guia({
      id: 3,
      pacienteId: 2,
      pacienteNome: "Bia",
      statusAlerta: "Regular",
    });
    const esgotada = guia({
      id: 4,
      pacienteId: 3,
      pacienteNome: "Caio",
      statusAlerta: "Esgotada",
    });

    const resultado = filtrarPacientesComGuiasEmAlerta([
      paciente(1, "Ana", [regular]),
      paciente(2, "Bia", [renovar, regularDoMesmoPaciente]),
      paciente(3, "Caio", [esgotada]),
    ]);

    expect(resultado).toEqual([
      paciente(2, "Bia", [renovar, regularDoMesmoPaciente]),
      paciente(3, "Caio", [esgotada]),
    ]);
  });

  it.each([
    ["Regular", false],
    ["Renovar", true],
    ["Esgotada", true],
  ] as const)("marca status %s como disparo=%s", (statusAlerta, esperado) => {
    expect(guiaDisparaRelatorio({ statusAlerta })).toBe(esperado);
  });
});

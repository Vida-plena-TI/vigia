import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enviarRelatorioSemanal: vi.fn(),
  montarRelatorioSemanal: vi.fn(),
}));

vi.mock("@/lib/relatorio/enviar", () => ({
  enviarRelatorioSemanal: mocks.enviarRelatorioSemanal,
}));

vi.mock("@/lib/relatorio/montar", () => ({
  montarRelatorioSemanal: mocks.montarRelatorioSemanal,
}));

import { GET } from "../../app/api/cron/relatorio-semanal/route";

function request(authorization?: string): NextRequest {
  return new Request("https://vigia.example.com/api/cron/relatorio-semanal", {
    headers: authorization ? { authorization } : undefined,
  }) as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "segredo");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/cron/relatorio-semanal", () => {
  it("rejeita chamada sem Authorization", async () => {
    const resposta = await GET(request());

    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toEqual({
      ok: false,
      erro: "Não autorizado.",
    });
    expect(mocks.montarRelatorioSemanal).not.toHaveBeenCalled();
    expect(mocks.enviarRelatorioSemanal).not.toHaveBeenCalled();
  });

  it("rejeita Authorization incorreto", async () => {
    const resposta = await GET(request("Bearer outro"));

    expect(resposta.status).toBe(401);
    expect(mocks.montarRelatorioSemanal).not.toHaveBeenCalled();
    expect(mocks.enviarRelatorioSemanal).not.toHaveBeenCalled();
  });

  it("avisa quando CRON_SECRET não está configurado", async () => {
    vi.stubEnv("CRON_SECRET", "");

    const resposta = await GET(request("Bearer segredo"));

    expect(resposta.status).toBe(500);
    expect(await resposta.json()).toEqual({
      ok: false,
      erro: "CRON_SECRET não configurado.",
    });
    expect(mocks.montarRelatorioSemanal).not.toHaveBeenCalled();
    expect(mocks.enviarRelatorioSemanal).not.toHaveBeenCalled();
  });

  it("monta e envia o relatório com Authorization válido", async () => {
    const pacientes = [{ id: 1, nome: "Ana", guias: [] }];

    mocks.montarRelatorioSemanal.mockResolvedValue(pacientes);
    mocks.enviarRelatorioSemanal.mockResolvedValue({
      enviado: true,
      id: "email_123",
    });

    const resposta = await GET(request("Bearer segredo"));

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({
      ok: true,
      pacientes: 1,
      enviado: true,
      emailId: "email_123",
    });
    expect(mocks.enviarRelatorioSemanal).toHaveBeenCalledWith(pacientes);
  });
});

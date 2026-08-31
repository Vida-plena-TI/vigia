import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PacienteDoRelatorioSemanal } from "./montar";
import {
  enviarRelatorioSemanal,
  montarHtmlDoRelatorioSemanal,
} from "./enviar";

function relatorio(): PacienteDoRelatorioSemanal[] {
  return [
    {
      id: 1,
      nome: "Ana & Cia",
      guias: [
        {
          id: 10,
          pacienteId: 1,
          pacienteNome: "Ana & Cia",
          requisicaoId: 20,
          numeroRequisicao: "<REQ-1>",
          terapiaId: 30,
          terapiaNome: "Fono",
          codigoTiss: "123",
          qtdAutorizada: 8,
          qtdUtilizada: 7,
          saldoRestante: 1,
          validade: null,
          statusAlerta: "Renovar",
        },
      ],
    },
  ];
}

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "rk_test");
  vi.stubEnv("REPORT_EMAIL_TO", "clinica@example.com, gestao@example.com");
  vi.stubEnv("REPORT_EMAIL_FROM", "VIGIA <relatorios@example.com>");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("enviarRelatorioSemanal", () => {
  it("não envia nada quando não há pacientes", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RESEND_API_KEY", "");

    await expect(enviarRelatorioSemanal([])).resolves.toEqual({
      enviado: false,
      motivo: "sem-pacientes",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("envia o HTML pelo Resend quando há pacientes", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "email_123" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(enviarRelatorioSemanal(relatorio())).resolves.toEqual({
      enviado: true,
      id: "email_123",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer rk_test",
          "Content-Type": "application/json",
        },
      }),
    );

    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const corpo = JSON.parse(String(init.body));

    expect(corpo).toMatchObject({
      from: "VIGIA <relatorios@example.com>",
      to: ["clinica@example.com", "gestao@example.com"],
      subject: "VIGIA - Relatório semanal de guias",
    });
    expect(corpo.html).toContain("Ana &amp; Cia");
    expect(corpo.html).toContain("&lt;REQ-1&gt;");
  });

  it("falha com mensagem clara quando o Resend recusa o envio", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("erro", { status: 422 })),
    );

    await expect(enviarRelatorioSemanal(relatorio())).rejects.toThrow(
      "Falha ao enviar relatório semanal pelo Resend (422): erro",
    );
  });
});

describe("montarHtmlDoRelatorioSemanal", () => {
  it("monta uma tabela por paciente, guia e status", () => {
    const html = montarHtmlDoRelatorioSemanal(relatorio());

    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).toContain("Paciente");
    expect(html).toContain("Guia");
    expect(html).toContain("Status");
    expect(html).toContain("Renovar");
  });
});

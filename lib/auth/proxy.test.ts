import { NextRequest } from "next/server";
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
import { config, dispensaSessao, proxy } from "@/proxy";

const BASE = "https://vigia.example.com";

function requisicao(
  pathname: string,
  init?: { authorization?: string; cookie?: string },
): NextRequest {
  const headers = new Headers();

  if (init?.authorization) {
    headers.set("authorization", init.authorization);
  }

  if (init?.cookie) {
    headers.set("cookie", init.cookie);
  }

  return new NextRequest(new URL(pathname, BASE), { headers });
}

/** O proxy redirecionou para o login? */
function redirecionouParaLogin(resposta: Response): boolean {
  const location = resposta.headers.get("location");

  return (
    resposta.status >= 300 &&
    resposta.status < 400 &&
    location !== null &&
    new URL(location, BASE).pathname === "/login"
  );
}

/** O `matcher` do `config` casaria este caminho? */
function matcherCasa(pathname: string): boolean {
  const [padrao] = config.matcher;

  return new RegExp(`^${padrao}$`).test(pathname);
}

describe("proxy — triagem de sessão", () => {
  // Controle: sem isto, um teste que nunca detectasse redirect passaria vazio.
  it("redireciona rota protegida sem sessão para /login", async () => {
    const resposta = await proxy(requisicao("/klini/dashboard"));

    expect(redirecionouParaLogin(resposta)).toBe(true);
    expect(resposta.status).toBe(307);
  });

  it("deixa passar as rotas públicas", async () => {
    for (const rota of ["/login", "/api/auth/login"]) {
      expect(redirecionouParaLogin(await proxy(requisicao(rota)))).toBe(false);
    }
  });
});

/**
 * Regressão do bug de produção: o proxy interceptava `/api/cron/...` e devolvia
 * 307 para `/login`, com e sem o header `Authorization`. A checagem de
 * `CRON_SECRET` dentro da rota nunca rodava.
 */
describe("proxy — rotas de cron", () => {
  it("não redireciona /api/cron/relatorio-semanal sem cookie mas com Bearer", async () => {
    const resposta = await proxy(
      requisicao("/api/cron/relatorio-semanal", {
        authorization: "Bearer segredo",
      }),
    );

    expect(redirecionouParaLogin(resposta)).toBe(false);
    expect(resposta.status).toBe(200);
  });

  it("não redireciona nem sem Authorization — quem decide é a rota", async () => {
    const resposta = await proxy(requisicao("/api/cron/relatorio-semanal"));

    expect(redirecionouParaLogin(resposta)).toBe(false);
  });

  it("dispensa sessão em qualquer rota futura sob /api/cron/", () => {
    expect(dispensaSessao("/api/cron")).toBe(true);
    expect(dispensaSessao("/api/cron/relatorio-semanal")).toBe(true);
    expect(dispensaSessao("/api/cron/qualquer-coisa-futura")).toBe(true);
  });

  it("não dispensa sessão em caminho que só começa parecido", () => {
    expect(dispensaSessao("/api/cronicas")).toBe(false);
    expect(dispensaSessao("/klini/dashboard")).toBe(false);
  });

  it("o matcher exclui /api/cron e mantém o resto", () => {
    expect(matcherCasa("/api/cron/relatorio-semanal")).toBe(false);
    expect(matcherCasa("/klini/dashboard")).toBe(true);
    expect(matcherCasa("/api/cronicas")).toBe(true);
  });
});

/**
 * As duas camadas juntas. O teste do Prompt 9 (`lib/relatorio/route.test.ts`)
 * chama `GET` direto e por isso passava mesmo com o proxy quebrado.
 */
describe("proxy + rota do relatório semanal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "segredo");
    mocks.montarRelatorioSemanal.mockResolvedValue([]);
    mocks.enviarRelatorioSemanal.mockResolvedValue({
      enviado: false,
      motivo: "sem-pacientes",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("com Bearer correto, alcança a lógica da rota", async () => {
    const request = requisicao("/api/cron/relatorio-semanal", {
      authorization: "Bearer segredo",
    });

    expect(redirecionouParaLogin(await proxy(request))).toBe(false);

    const resposta = await GET(request);

    expect(resposta.status).toBe(200);
    expect(mocks.montarRelatorioSemanal).toHaveBeenCalledOnce();
    expect(await resposta.json()).toMatchObject({ ok: true, enviado: false });
  });

  it("a checagem de CRON_SECRET continua valendo depois do proxy", async () => {
    const request = requisicao("/api/cron/relatorio-semanal", {
      authorization: "Bearer errado",
    });

    expect(redirecionouParaLogin(await proxy(request))).toBe(false);

    const resposta = await GET(request);

    expect(resposta.status).toBe(401);
    expect(mocks.montarRelatorioSemanal).not.toHaveBeenCalled();
  });
});

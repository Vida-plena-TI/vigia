/**
 * O painel da SulAmérica leva ao cadastro por um botão (link do Next com o
 * visual do `Button`), não mais por um link de texto no parágrafo.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getPrismaClient: () => ({ usuario: { findUnique: mocks.findUnique } }),
}));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.getSession }));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-klini-pathname": "/sulamerica/dashboard" }),
}));
vi.mock("@/lib/domain/autorizacoes-sulamerica", () => ({
  listarAutorizacoes: async () => [],
  contarPorStatusDeAutorizacao: () => ({ Vencido: 0, "Vence este mês": 0, "A vencer": 0 }),
  excluirAutorizacao: vi.fn(),
  registrarAutorizacao: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  mocks.getSession.mockResolvedValue({ usuarioId: 7, papel: "admin" });
  mocks.findUnique.mockResolvedValue({ id: 7, username: "quem-seja", ativo: true, papel: "admin" });
});

describe("painel SulAmérica — botão Registrar Encaminhamento", () => {
  it("é um link para /sulamerica/encaminhamentos com o texto exato, e o link antigo saiu", async () => {
    const Pagina = (await import("./page")).default;
    const saida = renderToStaticMarkup(await Pagina());

    const links = [...saida.matchAll(/<a[^>]*>[^]*?<\/a>/g)].map(([a]) => a);
    const botao = links.filter((a) => a.includes('href="/sulamerica/encaminhamentos"'));

    expect(botao).toHaveLength(1);
    expect(botao[0]).toContain('data-slot="button"');
    expect(botao[0]).toContain("h-10");
    expect(botao[0].replace(/<[^>]+>/g, "").trim()).toBe("Registrar Encaminhamento");
    expect(botao[0]).toContain("<svg");
    expect(saida).not.toContain("Cadastrar encaminhamento");
    expect(saida).not.toMatch(/<button[^>]*>\s*Registrar Encaminhamento/);
  });
});

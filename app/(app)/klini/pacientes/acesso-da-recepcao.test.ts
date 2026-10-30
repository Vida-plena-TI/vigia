/**
 * As duas abas Cadastro (`/klini/pacientes` e `/sulamerica/pacientes`) são só
 * do admin — página e actions (o cadastro e, desde 30/10/2026, a exclusão
 * permanente do paciente, que saiu de Encaminhamentos para cá).
 *
 * Mesmo desenho dos testes de acesso das abas de Encaminhamentos: só o cookie
 * e o Postgres são dublês; a página e a action rodam de verdade e decidem pelo
 * papel **lido do banco**. O cookie diz "admin" de propósito, para não restar
 * dúvida de qual dos dois foi consultado. Se a checagem de papel sair da
 * página ou da action, estes testes caem.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MENSAGEM_SEM_PERMISSAO } from "@/lib/auth/acesso";
import type { PapelUsuario } from "@/lib/auth/papel";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  getSession: vi.fn(),
  refresh: vi.fn(),
  listarPacientesDoConvenio: vi.fn(),
  listarTerapias: vi.fn(),
  cadastrarPaciente: vi.fn(),
  contarParaExclusao: vi.fn(),
  excluirPacientePeloId: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getPrismaClient: () => ({ usuario: { findUnique: mocks.findUnique } }),
}));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.getSession }));
vi.mock("next/cache", () => ({ refresh: mocks.refresh }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-klini-pathname": "/klini/pacientes" }),
}));
vi.mock("@/lib/domain/plano-terapias", () => ({
  listarPacientesDoConvenio: mocks.listarPacientesDoConvenio,
  listarTerapias: mocks.listarTerapias,
  cadastrarPaciente: mocks.cadastrarPaciente,
}));
vi.mock("@/lib/domain/pacientes", () => ({
  contarParaExclusao: mocks.contarParaExclusao,
  excluirPacientePeloId: mocks.excluirPacientePeloId,
}));

function logado(papelNoBanco: PapelUsuario) {
  mocks.getSession.mockResolvedValue({ usuarioId: 7, papel: "admin" });
  mocks.findUnique.mockResolvedValue({
    id: 7,
    username: "quem-seja",
    ativo: true,
    papel: papelNoBanco,
  });
}

function formulario(convenio: string): FormData {
  const dados = new FormData();
  dados.set("nome", "Fulano de Tal");
  dados.set("convenio", convenio);
  dados.append("terapiaId", "1");
  dados.append("horas", "2");
  return dados;
}

beforeEach(() => {
  vi.clearAllMocks();
  // `getUsuarioAtual` é memoizado com o `cache` do React.
  vi.resetModules();

  mocks.listarPacientesDoConvenio.mockResolvedValue([
    {
      pacienteId: 1,
      pacienteNome: "Fulano de Tal",
      plano: [{ terapiaId: 1, terapiaNome: "Fono", minutosSemanais: 150 }],
      temPlano: true,
    },
    { pacienteId: 2, pacienteNome: "Legado Sem Plano", plano: [], temPlano: false },
  ]);
  mocks.listarTerapias.mockResolvedValue([
    { id: 1, nome: "Fono", codigoTiss: "1" },
    { id: 2, nome: "TO", codigoTiss: "2" },
  ]);
});

const PAGINAS = [
  ["klini", () => import("./page")],
  ["sulamerica", () => import("../../sulamerica/pacientes/page")],
] as const;

describe.each(PAGINAS)("página Cadastro (%s)", (convenio, carregar) => {
  it("recepção é desviada para o painel antes de qualquer leitura", async () => {
    logado("recepcao");
    const Pagina = (await carregar()).default;

    await expect(Pagina()).rejects.toMatchObject({
      digest: expect.stringContaining("/klini/dashboard"),
    });

    expect(mocks.findUnique).toHaveBeenCalled();
    expect(mocks.listarPacientesDoConvenio).not.toHaveBeenCalled();
    expect(mocks.listarTerapias).not.toHaveBeenCalled();
  });

  it("admin lê só os pacientes do convênio da página, e o formulário grava esse convênio", async () => {
    logado("admin");
    const Pagina = (await carregar()).default;

    const saida = renderToStaticMarkup(await Pagina());

    expect(mocks.listarPacientesDoConvenio).toHaveBeenCalledExactlyOnceWith(convenio);
    expect(saida).toContain(`name="convenio" value="${convenio}"`);
    // Rótulos visíveis e o texto de apoio das horas.
    expect(saida).toContain("Nome do paciente");
    expect(saida).toContain("Tempo por semana (horas)");
    expect(saida).toContain("Digite em horas, por exemplo 2 ou 2,5.");
    expect(saida).toContain("Adicionar terapia");
    expect(saida).toContain("Cadastrar paciente");
    // O plano resumido e o legado sem plano.
    expect(saida).toContain("Fono 2 h 30 min");
    expect(saida).toContain("Plano não cadastrado");
    expect(saida).toContain("Editar");
    expect(saida).toContain("Trocar convênio");
    // O "Excluir" (exclusão permanente) de cada paciente, ao lado do "Editar".
    expect(saida).toContain('aria-label="Excluir cadastro de Fulano de Tal"');
    expect(saida).toContain('aria-label="Excluir cadastro de Legado Sem Plano"');
  });
});

describe("action do Cadastro chamada direto pela recepção", () => {
  it.each(["klini", "sulamerica", "outro"])(
    "convênio %s é recusado e o domínio nem é chamado",
    async (convenio) => {
      logado("recepcao");
      const { cadastrarPacienteAction } = await import(
        "@/lib/domain/plano-terapias-actions"
      );

      expect(await cadastrarPacienteAction({}, formulario(convenio))).toEqual({
        erro: MENSAGEM_SEM_PERMISSAO,
      });
      expect(mocks.cadastrarPaciente).not.toHaveBeenCalled();
      expect(mocks.refresh).not.toHaveBeenCalled();
    },
  );

  it("controle: o admin chega ao domínio com o convênio do formulário", async () => {
    logado("admin");
    mocks.cadastrarPaciente.mockResolvedValue({
      ok: true,
      pacienteId: 1,
      pacienteNome: "Fulano de Tal",
      pacienteCriado: true,
      convenioAdotado: false,
      linhasSubstituidas: 0,
      terapias: 1,
    });
    const { cadastrarPacienteAction } = await import(
      "@/lib/domain/plano-terapias-actions"
    );

    const estado = await cadastrarPacienteAction({}, formulario("sulamerica"));

    expect(estado.sucesso).toMatchObject({ pacienteCriado: true });
    expect(mocks.cadastrarPaciente).toHaveBeenCalledWith(
      expect.objectContaining({ convenio: "sulamerica" }),
    );
  });
});

describe("exclusão permanente pelo Cadastro chamada direto pela recepção", () => {
  it.each(["klini", "sulamerica"] as const)(
    "convênio %s: contar e excluir são recusados sem ler nem apagar nada",
    async (convenio) => {
      logado("recepcao");
      const { contarParaExcluirPaciente, excluirPaciente } = await import(
        "@/lib/domain/pacientes-actions"
      );

      expect(await contarParaExcluirPaciente(1, convenio)).toEqual({
        ok: false,
        erro: MENSAGEM_SEM_PERMISSAO,
      });
      expect(await excluirPaciente(1, convenio)).toEqual({
        ok: false,
        erro: MENSAGEM_SEM_PERMISSAO,
      });
      expect(mocks.contarParaExclusao).not.toHaveBeenCalled();
      expect(mocks.excluirPacientePeloId).not.toHaveBeenCalled();
      expect(mocks.refresh).not.toHaveBeenCalled();
    },
  );

  it.each(["klini", "sulamerica"] as const)(
    "controle: o admin (convênio %s) chega à função de domínio de sempre",
    async (convenio) => {
      logado("admin");
      mocks.excluirPacientePeloId.mockResolvedValue({
        ok: true,
        pacienteNome: "Fulano de Tal",
        requisicoes: 1,
        guias: 2,
        atendimentos: 3,
      });
      const { excluirPaciente } = await import("@/lib/domain/pacientes-actions");

      expect(await excluirPaciente(1, convenio)).toMatchObject({ ok: true });
      expect(mocks.excluirPacientePeloId).toHaveBeenCalledExactlyOnceWith(1);
      expect(mocks.refresh).toHaveBeenCalledOnce();
    },
  );
});

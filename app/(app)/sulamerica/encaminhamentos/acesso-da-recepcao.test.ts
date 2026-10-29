/**
 * A recepção não alcança Encaminhamentos da SulAmérica nem recebe carteirinha,
 * CRM ou nome do médico — nem pela página, nem pelas actions.
 *
 * Mesmo desenho do teste da aba da Klini: só o cookie e o Postgres são
 * dublês; a página e as actions rodam de verdade e decidem pelo papel **lido
 * do banco**. O cookie diz "admin" de propósito. Os valores dos dublês são
 * sentinelas: se algum caminho os entregasse, apareceriam na saída.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { MENSAGEM_SEM_PERMISSAO } from "@/lib/auth/acesso";
import type { PapelUsuario } from "@/lib/auth/papel";

const CARTEIRINHA_SENTINELA = "SENTINELA98765";
const CRM_SENTINELA = "8765432109";
const MEDICO_SENTINELA = "Dra. Sentinela Quatro";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  getSession: vi.fn(),
  refresh: vi.fn(),
  listarEncaminhamentosSulamerica: vi.fn(),
  registrarAutorizacao: vi.fn(),
  excluirAutorizacao: vi.fn(),
  listarPacientesParaEncaminhamento: vi.fn(),
  dataDeHoje: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getPrismaClient: () => ({ usuario: { findUnique: mocks.findUnique } }),
}));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.getSession }));
vi.mock("next/cache", () => ({ refresh: mocks.refresh }));
vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({ "x-klini-pathname": "/sulamerica/encaminhamentos" }),
}));
vi.mock("@/lib/domain/autorizacoes-sulamerica", () => ({
  listarEncaminhamentosSulamerica: mocks.listarEncaminhamentosSulamerica,
  registrarAutorizacao: mocks.registrarAutorizacao,
  excluirAutorizacao: mocks.excluirAutorizacao,
}));
vi.mock("@/lib/domain/pacientes", () => ({
  listarPacientesParaEncaminhamento: mocks.listarPacientesParaEncaminhamento,
}));
vi.mock("@/lib/domain/atendimentos", () => ({ dataDeHoje: mocks.dataDeHoje }));

function logado(papelNoBanco: PapelUsuario) {
  mocks.getSession.mockResolvedValue({ usuarioId: 7, papel: "admin" });
  mocks.findUnique.mockResolvedValue({
    id: 7,
    username: "quem-seja",
    ativo: true,
    papel: papelNoBanco,
  });
}

function formulario(): FormData {
  const dados = new FormData();
  dados.set("pacienteNome", "Fulano de Tal");
  dados.set("dataInicio", "2026-10-28");
  dados.set("prazoMeses", "6");
  dados.set("numeroCarteirinha", CARTEIRINHA_SENTINELA);
  dados.set("crmMedico", CRM_SENTINELA);
  dados.set("nomeMedico", MEDICO_SENTINELA);
  return dados;
}

function semSentinela(valor: unknown) {
  const texto = JSON.stringify(valor) ?? "";
  expect(texto).not.toContain(CARTEIRINHA_SENTINELA);
  expect(texto).not.toContain(CRM_SENTINELA);
  expect(texto).not.toContain(MEDICO_SENTINELA);
}

beforeEach(() => {
  vi.clearAllMocks();
  // `getUsuarioAtual` é memoizado com o `cache` do React.
  vi.resetModules();

  mocks.listarEncaminhamentosSulamerica.mockResolvedValue([
    {
      id: 1,
      pacienteId: 1,
      pacienteNome: "Fulano de Tal",
      dataInicio: "2026-10-28",
      prazoMeses: 6,
      dataVencimento: "2027-04-28",
      statusAutorizacao: null,
      numeroCarteirinha: CARTEIRINHA_SENTINELA,
      crmMedico: CRM_SENTINELA,
      nomeMedico: MEDICO_SENTINELA,
    },
  ]);
  mocks.listarPacientesParaEncaminhamento.mockResolvedValue([
    { nome: "Fulano de Tal", temCarteirinha: true },
  ]);
  mocks.dataDeHoje.mockResolvedValue("2026-10-28");
});

async function carregarPagina() {
  return (await import("./page")).default;
}

describe("página de Encaminhamentos da SulAmérica", () => {
  it("recepção é desviada antes de qualquer leitura da lista", async () => {
    logado("recepcao");
    const Pagina = await carregarPagina();

    await expect(Pagina()).rejects.toMatchObject({
      digest: expect.stringContaining("/klini/dashboard"),
    });

    expect(mocks.findUnique).toHaveBeenCalled();
    expect(mocks.listarEncaminhamentosSulamerica).not.toHaveBeenCalled();
    expect(mocks.listarPacientesParaEncaminhamento).not.toHaveBeenCalled();
  });

  it("controle: para o admin a mesma página lê a lista (o dublê está ligado)", async () => {
    logado("admin");
    const Pagina = await carregarPagina();

    await Pagina();

    expect(mocks.listarEncaminhamentosSulamerica).toHaveBeenCalledOnce();
    // O datalist só traz os pacientes da SulAmérica (regra 24).
    expect(mocks.listarPacientesParaEncaminhamento).toHaveBeenCalledExactlyOnceWith("sulamerica");
  });
});

describe("actions da SulAmérica chamadas direto pela recepção", () => {
  beforeEach(() => logado("recepcao"));

  it("cadastrar encaminhamento é recusado, nada é gravado e nada volta", async () => {
    const { criarEncaminhamentoSulamericaAction } =
      await import("@/lib/domain/autorizacoes-sulamerica-actions");

    const estado = await criarEncaminhamentoSulamericaAction({}, formulario());

    expect(estado).toEqual({ erro: MENSAGEM_SEM_PERMISSAO });
    expect(mocks.registrarAutorizacao).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    semSentinela(estado);
  });

  it("excluir autorização é recusado sem chamar o domínio", async () => {
    const { excluirAutorizacaoAction } =
      await import("@/lib/domain/autorizacoes-sulamerica-actions");

    expect(await excluirAutorizacaoAction(1)).toEqual({
      ok: false,
      erro: MENSAGEM_SEM_PERMISSAO,
    });
    expect(mocks.excluirAutorizacao).not.toHaveBeenCalled();
  });
});

describe("mesmo para o admin, a action não devolve os números nem o médico", () => {
  it("o estado de sucesso leva só nome, datas e prazo", async () => {
    logado("admin");
    mocks.registrarAutorizacao.mockResolvedValue({
      ok: true,
      id: 1,
      pacienteNome: "Fulano de Tal",
      pacienteCriado: true,
      dataInicio: "2026-10-28",
      prazoMeses: 6,
      dataVencimento: "2027-04-28",
      substituiuAnterior: false,
      // Se o domínio um dia passar a devolvê-los, a action não repassa.
      numeroCarteirinha: CARTEIRINHA_SENTINELA,
      crmMedico: CRM_SENTINELA,
      nomeMedico: MEDICO_SENTINELA,
    });
    const { criarEncaminhamentoSulamericaAction } =
      await import("@/lib/domain/autorizacoes-sulamerica-actions");

    const estado = await criarEncaminhamentoSulamericaAction({}, formulario());

    expect(estado.sucesso?.pacienteNome).toBe("Fulano de Tal");
    expect(mocks.registrarAutorizacao).toHaveBeenCalledOnce();
    semSentinela(estado);
  });
});

describe("nenhum outro caminho lê a lista com os números", () => {
  it("`listarEncaminhamentosSulamerica` só é chamada pela página da aba", () => {
    const raiz = join(__dirname, "../../../..");
    const chamadores: string[] = [];

    for (const pasta of ["app", "lib", "components"]) {
      for (const arquivo of readdirSync(join(raiz, pasta), {
        recursive: true,
        encoding: "utf8",
      })) {
        if (
          !/\.(ts|tsx)$/.test(arquivo) ||
          /\.test\.ts$/.test(arquivo) ||
          arquivo.includes("generated")
        ) {
          continue;
        }

        const caminho = join(raiz, pasta, arquivo);
        if (
          /\blistarEncaminhamentosSulamerica\(/.test(readFileSync(caminho, "utf8"))
        ) {
          chamadores.push(relative(raiz, caminho));
        }
      }
    }

    expect(chamadores.sort()).toEqual([
      join("app", "(app)", "sulamerica", "encaminhamentos", "page.tsx"),
      join("lib", "domain", "autorizacoes-sulamerica.ts"),
    ]);
  });
});

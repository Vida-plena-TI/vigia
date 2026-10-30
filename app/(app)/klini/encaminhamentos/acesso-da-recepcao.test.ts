/**
 * A recepção não recebe carteirinha nem CRM por nenhum caminho de
 * Encaminhamentos — nem pela página, nem pelas actions.
 *
 * Mesmo desenho de `lib/domain/acesso-por-papel.test.ts`: o que se troca por
 * dublê é só o que está *abaixo* da decisão (o cookie e o Postgres). A página
 * e as actions rodam de verdade, e decidem pelo papel **lido do banco**; o
 * cookie diz "admin" de propósito, para não restar dúvida de qual dos dois foi
 * consultado.
 *
 * Os números de carteirinha e CRM dos dublês são sentinelas: se algum caminho
 * os entregasse, eles apareceriam na saída serializada.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { MENSAGEM_SEM_PERMISSAO } from "@/lib/auth/acesso";
import type { PapelUsuario } from "@/lib/auth/papel";

const CARTEIRINHA_SENTINELA = "SENTINELA98765";
const CRM_SENTINELA = "8765432109";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  getSession: vi.fn(),
  refresh: vi.fn(),
  listarEncaminhamentos: vi.fn(),
  registrarEncaminhamento: vi.fn(),
  listarPacientesParaEncaminhamento: vi.fn(),
  removerEncaminhamento: vi.fn(),
  dataDeHoje: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getPrismaClient: () => ({ usuario: { findUnique: mocks.findUnique } }),
}));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.getSession }));
vi.mock("next/cache", () => ({ refresh: mocks.refresh }));
vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({ "x-klini-pathname": "/klini/encaminhamentos" }),
}));
vi.mock("@/lib/domain/encaminhamentos", () => ({
  listarEncaminhamentos: mocks.listarEncaminhamentos,
  registrarEncaminhamento: mocks.registrarEncaminhamento,
  removerEncaminhamento: mocks.removerEncaminhamento,
  contarPorStatusDeEncaminhamento: () => ({
    Vencido: 0,
    "Vence este mês": 0,
    "A vencer": 0,
  }),
}));
vi.mock("@/lib/domain/pacientes", () => ({
  listarPacientesParaEncaminhamento: mocks.listarPacientesParaEncaminhamento,
}));
vi.mock("@/lib/domain/atendimentos", () => ({ dataDeHoje: mocks.dataDeHoje }));

function logado(papelNoBanco: PapelUsuario) {
  // O cookie diz admin; quem vale é o banco.
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
  dados.set("dataEncaminhamento", "2026-10-28");
  dados.set("numeroCarteirinha", CARTEIRINHA_SENTINELA);
  dados.set("crmMedico", CRM_SENTINELA);
  return dados;
}

function semSentinela(valor: unknown) {
  const texto = JSON.stringify(valor) ?? "";
  expect(texto).not.toContain(CARTEIRINHA_SENTINELA);
  expect(texto).not.toContain(CRM_SENTINELA);
}

beforeEach(() => {
  vi.clearAllMocks();
  // `getUsuarioAtual` é memoizado com o `cache` do React; cada teste precisa
  // de módulos novos para não decidir com o usuário do teste anterior.
  vi.resetModules();

  mocks.listarEncaminhamentos.mockResolvedValue([
    {
      id: 1,
      pacienteId: 1,
      pacienteNome: "Fulano de Tal",
      numeroCarteirinha: CARTEIRINHA_SENTINELA,
      crmMedico: CRM_SENTINELA,
      dataEncaminhamento: "2026-10-28",
      dataVencimento: "2027-04-26",
      statusEncaminhamento: null,
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

describe("página de Encaminhamentos", () => {
  it("recepção é desviada antes de qualquer leitura da lista", async () => {
    logado("recepcao");
    const Pagina = await carregarPagina();

    await expect(Pagina()).rejects.toMatchObject({
      digest: expect.stringContaining("/klini/dashboard"),
    });

    expect(mocks.findUnique).toHaveBeenCalled();
    expect(mocks.listarEncaminhamentos).not.toHaveBeenCalled();
    expect(mocks.listarPacientesParaEncaminhamento).not.toHaveBeenCalled();
  });

  it("controle: para o admin a mesma página lê a lista (o dublê está ligado)", async () => {
    logado("admin");
    const Pagina = await carregarPagina();

    await Pagina();

    expect(mocks.listarEncaminhamentos).toHaveBeenCalledOnce();
    // O datalist só traz os pacientes da Klini (regra 24).
    expect(mocks.listarPacientesParaEncaminhamento).toHaveBeenCalledExactlyOnceWith("klini");
  });
});

describe("actions de Encaminhamentos chamadas direto pela recepção", () => {
  beforeEach(() => logado("recepcao"));

  it("cadastrar é recusado, nada é gravado e nada volta", async () => {
    const { criarEncaminhamentoAction } =
      await import("@/lib/domain/encaminhamentos-actions");

    const estado = await criarEncaminhamentoAction({}, formulario());

    expect(estado).toEqual({ erro: MENSAGEM_SEM_PERMISSAO });
    expect(mocks.registrarEncaminhamento).not.toHaveBeenCalled();
    semSentinela(estado);
  });

  it("remover encaminhamento é recusado e nada é apagado", async () => {
    const { removerEncaminhamentoAction } =
      await import("@/lib/domain/encaminhamentos-actions");

    expect(await removerEncaminhamentoAction(1)).toEqual({
      ok: false,
      erro: MENSAGEM_SEM_PERMISSAO,
    });
    expect(mocks.removerEncaminhamento).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("mesmo para o admin, a action não devolve os números", () => {
  it("o estado de sucesso leva só nome e datas", async () => {
    logado("admin");
    mocks.registrarEncaminhamento.mockResolvedValue({
      ok: true,
      pacienteNome: "Fulano de Tal",
      dataEncaminhamento: "2026-10-28",
      dataVencimento: "2027-04-26",
      substituiuAnterior: false,
      // Se o domínio um dia passar a devolvê-los, a action não repassa.
      numeroCarteirinha: CARTEIRINHA_SENTINELA,
      crmMedico: CRM_SENTINELA,
    });
    const { criarEncaminhamentoAction } =
      await import("@/lib/domain/encaminhamentos-actions");

    const estado = await criarEncaminhamentoAction({}, formulario());

    expect(estado.sucesso?.pacienteNome).toBe("Fulano de Tal");
    semSentinela(estado);
  });
});

describe("nenhum outro caminho lê a lista com os números", () => {
  it("`listarEncaminhamentos` só é chamada pela página de Encaminhamentos", () => {
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
        if (/\blistarEncaminhamentos\(/.test(readFileSync(caminho, "utf8"))) {
          chamadores.push(relative(raiz, caminho));
        }
      }
    }

    expect(chamadores.sort()).toEqual([
      join("app", "(app)", "klini", "encaminhamentos", "page.tsx"),
      join("lib", "domain", "encaminhamentos.ts"),
    ]);
  });
});

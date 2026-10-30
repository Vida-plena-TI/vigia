/**
 * O plano semanal no painel da Klini: chega aos dois papéis, numa consulta só,
 * e nenhuma consulta da página toca em carteirinha, CRM ou nome do médico.
 *
 * Mesmo desenho dos testes de acesso das abas: só o cookie e o Postgres são
 * dublês. A página, `listarGuiasDoDashboard` e `planosDosPacientes` rodam de
 * verdade; o dublê do `$queryRaw` guarda o texto de cada SQL e responde pelo
 * que a consulta lê. O cookie diz "admin" de propósito — quem decide o link
 * "Cadastrar plano" é o papel do banco.
 *
 * A outra metade da garantia é a varredura no fim: os arquivos de que o painel
 * lê dados não citam as colunas sensíveis em lugar nenhum.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PapelUsuario } from "@/lib/auth/papel";

/** As colunas (e os campos que as levariam) que o painel nunca lê. */
const COLUNAS_SENSIVEIS =
  /numero_carteirinha|crm_medico|nome_medico|numeroCarteirinha|crmMedico|nomeMedico/;

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  getSession: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getPrismaClient: () => ({
    usuario: { findUnique: mocks.findUnique },
    $queryRaw: (sql: TemplateStringsArray, ...valores: unknown[]) =>
      mocks.queryRaw(sql.join("?"), valores),
  }),
}));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.getSession }));
// As actions puxariam sessão e banco; a renderização não as chama.
vi.mock("@/lib/domain/situacao-requisicao-actions", () => ({
  alterarSituacaoDaRequisicaoAction: vi.fn(),
}));
vi.mock("@/lib/domain/atendimentos-actions", () => ({
  editarAtendimento: vi.fn(),
  excluirAtendimento: vi.fn(),
}));
vi.mock("@/lib/domain/guias-actions", () => ({
  excluirGuia: vi.fn(),
  listarHistoricoDaGuia: vi.fn(),
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

function guia(id: number, pacienteId: number, pacienteNome: string) {
  return {
    id,
    pacienteId,
    pacienteNome,
    requisicaoId: id,
    numeroRequisicao: `REQ-${id}`,
    terapiaId: 1,
    terapiaNome: "Fono",
    codigoTiss: "123",
    qtdAutorizada: 8,
    qtdUtilizada: 0,
    saldoRestante: 8,
    validade: null,
    statusAlerta: "Regular",
    situacaoRequisicao: "aprovada",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // `getUsuarioAtual` é memoizado com o `cache` do React.
  vi.resetModules();

  mocks.queryRaw.mockImplementation(async (sql: string) => {
    if (sql.includes("requisicao_terapia_saldo")) {
      return [guia(1, 10, "Ana"), guia(2, 10, "Ana"), guia(3, 20, "Bruno")];
    }
    if (sql.includes("plano_terapia")) {
      return [
        { pacienteId: 10, terapiaId: 1, terapiaNome: "Fono", minutosSemanais: 150 },
        { pacienteId: 10, terapiaId: 2, terapiaNome: "TO", minutosSemanais: 60 },
      ];
    }
    throw new Error(`consulta inesperada no painel: ${sql}`);
  });
});

/** As props que a página entrega à lista (o que vai para o navegador). */
async function propsDaLista() {
  const Pagina = (await import("./page")).default;
  const arvore = await Pagina();
  const { ListaDeGuias } = await import("./lista-de-guias");

  const filhos = (arvore.props as { children: unknown[] }).children;
  const lista = filhos.find(
    (filho): filho is { props: Record<string, unknown> } =>
      typeof filho === "object" &&
      filho !== null &&
      (filho as { type?: unknown }).type === ListaDeGuias,
  );

  if (!lista) throw new Error("a página não renderizou a lista");
  return { props: lista.props, arvore };
}

function sqlsDaPagina(): string[] {
  return mocks.queryRaw.mock.calls.map(([sql]) => sql as string);
}

describe("plano semanal no painel", () => {
  it("a recepção recebe o plano, sem link de Cadastro e sem colunas sensíveis", async () => {
    logado("recepcao");

    const { props, arvore } = await propsDaLista();

    expect(props.planos).toEqual({
      10: [
        { terapiaId: 1, terapiaNome: "Fono", minutosSemanais: 150 },
        { terapiaId: 2, terapiaNome: "TO", minutosSemanais: 60 },
      ],
      20: [],
    });
    expect(props.rotaDoCadastro).toBeNull();

    // Duas consultas: guias e planos (uma só para todos os pacientes).
    const sqls = sqlsDaPagina();
    expect(sqls).toHaveLength(2);
    expect(sqls.filter((sql) => sql.includes("plano_terapia"))).toHaveLength(1);
    for (const sql of sqls) {
      expect(sql).not.toMatch(COLUNAS_SENSIVEIS);
    }
    // Nada do payload inteiro da página cita os campos.
    expect(JSON.stringify(arvore)).not.toMatch(COLUNAS_SENSIVEIS);
  });

  it("a consulta do plano recebe os ids de todos os pacientes da lista, sem repetir", async () => {
    logado("recepcao");

    await propsDaLista();

    const [, valores] = mocks.queryRaw.mock.calls.find(([sql]) =>
      (sql as string).includes("plano_terapia"),
    )!;
    expect(valores).toEqual([[10, 20]]);
  });

  it("o admin recebe o mesmo plano e o link para a aba Cadastro", async () => {
    logado("admin");

    const { props } = await propsDaLista();

    expect(props.rotaDoCadastro).toBe("/klini/pacientes");
    expect((props.planos as Record<number, unknown[]>)[10]).toHaveLength(2);
  });
});

describe("varredura: o painel não lê carteirinha, CRM nem médico", () => {
  const raiz = join(__dirname, "../../../..");

  it("a página só lê dados de `guias` e `plano-terapias`", () => {
    const pagina = readFileSync(join(__dirname, "page.tsx"), "utf8");
    const modulos = [...pagina.matchAll(/from "@\/lib\/domain\/([^"]+)"/g)].map(
      ([, modulo]) => modulo,
    );

    expect(modulos.sort()).toEqual(["guias", "plano-terapias"]);
  });

  it("nem esses módulos nem os arquivos do painel citam as colunas", () => {
    const arquivos = [
      join(raiz, "lib", "domain", "guias.ts"),
      join(raiz, "lib", "domain", "plano-terapias.ts"),
      join(raiz, "lib", "domain", "tempo-semanal.ts"),
      ...readdirSync(__dirname)
        .filter((nome) => /\.tsx?$/.test(nome) && !/\.test\.ts$/.test(nome))
        .map((nome) => join(__dirname, nome)),
    ];

    const citam = arquivos.filter((arquivo) =>
      COLUNAS_SENSIVEIS.test(readFileSync(arquivo, "utf8")),
    );

    expect(arquivos.length).toBeGreaterThan(5);
    expect(citam).toEqual([]);
  });
});

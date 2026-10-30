/**
 * Camada autoritativa do controle de acesso por papel (Fase C).
 *
 * O cenario e o do POST montado a mao: a action e chamada **direto**, sem
 * navegacao nenhuma, como faria um `curl` com o cookie de uma recepcao. O proxy
 * nao roda nesse caminho — se a recusa dependesse dele, tudo aqui passaria.
 *
 * Por isso o que se troca por dublê e so o que esta *abaixo* da decisao: a
 * sessao (o cookie) e o Postgres. `getUsuarioAtual`, `requireUsuario` e
 * `autorizarRota` rodam de verdade, e a decisao sai do papel **lido do banco** —
 * que e exatamente o que o teste precisa provar. O dublê do Prisma devolve
 * papel diferente do que o cookie diria, para nao restar duvida de qual dos
 * dois foi consultado.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MENSAGEM_SEM_PERMISSAO } from "@/lib/auth/acesso";
import type { PapelUsuario } from "@/lib/auth/papel";

const mocks = vi.hoisted(() => ({
  registrarAutorizacao: vi.fn(),
  excluirAutorizacao: vi.fn(),
  findUnique: vi.fn(),
  getSession: vi.fn(),
  refresh: vi.fn(),
  criarRequisicao: vi.fn(),
  previsaoDeSubstituicao: vi.fn(),
  registrarEncaminhamento: vi.fn(),
  removerEncaminhamento: vi.fn(),
  contarParaExclusao: vi.fn(),
  excluirPacientePeloId: vi.fn(),
  cadastrarPaciente: vi.fn(),
  planoParaRequisicao: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getPrismaClient: () => ({ usuario: { findUnique: mocks.findUnique } }),
}));

vi.mock("@/lib/auth/session", () => ({
  getSession: mocks.getSession,
}));

vi.mock("next/cache", () => ({ refresh: mocks.refresh }));

vi.mock("./requisicoes", () => ({
  criarRequisicao: mocks.criarRequisicao,
  previsaoDeSubstituicao: mocks.previsaoDeSubstituicao,
}));

vi.mock("./encaminhamentos", () => ({
  registrarEncaminhamento: mocks.registrarEncaminhamento,
  removerEncaminhamento: mocks.removerEncaminhamento,
}));

vi.mock("./pacientes", () => ({
  contarParaExclusao: mocks.contarParaExclusao,
  excluirPacientePeloId: mocks.excluirPacientePeloId,
}));

vi.mock("./plano-terapias", () => ({
  cadastrarPaciente: mocks.cadastrarPaciente,
  planoParaRequisicao: mocks.planoParaRequisicao,
}));

vi.mock("./autorizacoes-sulamerica", () => ({
  registrarAutorizacao: mocks.registrarAutorizacao,
  excluirAutorizacao: mocks.excluirAutorizacao,
}));
import { criarEncaminhamentoSulamericaAction, excluirAutorizacaoAction } from "./autorizacoes-sulamerica-actions";

import {
  criarEncaminhamentoAction,
  removerEncaminhamentoAction,
} from "./encaminhamentos-actions";
import {
  contarParaExcluirPaciente,
  excluirPaciente,
} from "./pacientes-actions";
import { cadastrarPacienteAction } from "./plano-terapias-actions";
import {
  criarRequisicaoAction,
  planoParaRequisicaoAction,
  previsaoDeSubstituicaoAction,
} from "./requisicoes-actions";

/** Sessao valida no cookie; o papel de verdade e o que o banco responder. */
function logadoComoPapelNoBanco(papel: PapelUsuario) {
  mocks.getSession.mockResolvedValue({ usuarioId: 7 });
  mocks.findUnique.mockResolvedValue({
    id: 7,
    username: "quem-seja",
    ativo: true,
    papel,
  });
}

function formularioDeRequisicao(): FormData {
  const dados = new FormData();
  dados.set("pacienteNome", "Fulano de Tal");
  dados.set("numeroRequisicao", "123");
  dados.append("terapiaId", "1");
  dados.append("qtdAutorizada", "8");
  dados.append("validade", "");

  return dados;
}

function formularioDeEncaminhamento(): FormData {
  const dados = new FormData();
  dados.set("pacienteNome", "Fulano de Tal");
  dados.set("dataEncaminhamento", "2026-09-17");
  dados.set("numeroCarteirinha", "TESTE12345");
  dados.set("crmMedico", "123456");

  return dados;
}

function formularioSulamerica() {
  const dados = new FormData();
  dados.set("pacienteNome", "Fulano de Tal");
  dados.set("dataInicio", "2026-01-31");
  dados.set("prazoMeses", "3");
  dados.set("numeroCarteirinha", "TESTE12345");
  dados.set("crmMedico", "123456");
  dados.set("nomeMedico", "Dra. Teste");
  return dados;
}

function formularioDeCadastroDePaciente(convenio: string): FormData {
  const dados = new FormData();
  dados.set("nome", "Fulano de Tal");
  dados.set("convenio", convenio);
  dados.append("terapiaId", "1");
  dados.append("horas", "2,5");
  dados.append("terapiaId", "2");
  dados.append("horas", "1");
  return dados;
}

describe("cadastro de paciente com plano — decide pelo papel do banco", () => {
  it.each(["klini", "sulamerica", "outro"])(
    "recepção (cookie dizendo admin) é recusada com convênio %s, e o domínio nem é chamado",
    async (convenio) => {
      logadoComoPapelNoBanco("recepcao");
      mocks.getSession.mockResolvedValue({ usuarioId: 7, papel: "admin" });

      const estado = await cadastrarPacienteAction({}, formularioDeCadastroDePaciente(convenio));

      expect(estado).toEqual({ erro: MENSAGEM_SEM_PERMISSAO });
      expect(mocks.cadastrarPaciente).not.toHaveBeenCalled();
      expect(mocks.refresh).not.toHaveBeenCalled();
      expect(mocks.findUnique).toHaveBeenCalled();
    },
  );

  it("admin chega no domínio com as linhas costuradas por índice", async () => {
    logadoComoPapelNoBanco("admin");
    mocks.cadastrarPaciente.mockResolvedValue({
      ok: true, pacienteId: 9, pacienteNome: "Fulano de Tal", pacienteCriado: true,
      convenioAdotado: false, linhasSubstituidas: 0, terapias: 2,
    });

    const estado = await cadastrarPacienteAction({}, formularioDeCadastroDePaciente("sulamerica"));

    expect(mocks.cadastrarPaciente).toHaveBeenCalledWith({
      nome: "Fulano de Tal",
      convenio: "sulamerica",
      terapias: [
        { terapiaId: 1, horas: "2,5" },
        { terapiaId: 2, horas: "1" },
      ],
    });
    expect(estado.sucesso).toMatchObject({ pacienteNome: "Fulano de Tal", pacienteCriado: true });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("admin recebe o erro e a linha do domínio, sem refresh", async () => {
    logadoComoPapelNoBanco("admin");
    mocks.cadastrarPaciente.mockResolvedValue({ ok: false, erro: "x", linha: 1 });

    expect(await cadastrarPacienteAction({}, formularioDeCadastroDePaciente("klini"))).toEqual({
      erro: "x",
      linha: 1,
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("SulAmérica — actions decidem pelo banco, não pelo cookie", () => {
  it("cookie admin desatualizado não permite criar nem excluir como recepção", async () => {
    logadoComoPapelNoBanco("recepcao");
    mocks.getSession.mockResolvedValue({ usuarioId: 7, papel: "admin" });
    expect(await criarEncaminhamentoSulamericaAction({}, formularioSulamerica())).toEqual({ erro: MENSAGEM_SEM_PERMISSAO });
    expect(await excluirAutorizacaoAction(3)).toEqual({ ok: false, erro: MENSAGEM_SEM_PERMISSAO });
    expect(mocks.registrarAutorizacao).not.toHaveBeenCalled();
    expect(mocks.excluirAutorizacao).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.findUnique).toHaveBeenCalled();
  });

  it("admin no banco pode criar e excluir", async () => {
    logadoComoPapelNoBanco("admin");
    mocks.registrarAutorizacao.mockResolvedValue({ ok: true, dataVencimento: "2026-04-30" });
    mocks.excluirAutorizacao.mockResolvedValue({ ok: true });
    expect(await criarEncaminhamentoSulamericaAction({}, formularioSulamerica())).toMatchObject({ sucesso: { dataVencimento: "2026-04-30" } });
    expect(mocks.registrarAutorizacao).toHaveBeenCalledWith({
      pacienteNome: "Fulano de Tal", dataInicio: "2026-01-31", prazoMeses: 3,
      numeroCarteirinha: "TESTE12345", crmMedico: "123456", nomeMedico: "Dra. Teste",
    });
    expect(await excluirAutorizacaoAction(3)).toEqual({ ok: true });
    expect(mocks.excluirAutorizacao).toHaveBeenCalledWith(3);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  // `getUsuarioAtual` e memoizado por requisicao com o `cache` do React; fora
  // de uma requisicao cada teste precisa de um cache limpo, senao o segundo
  // teste decide com o usuario do primeiro.
  vi.resetModules();
});

describe("recepcao chamando as actions restritas direto", () => {
  beforeEach(() => {
    logadoComoPapelNoBanco("recepcao");
  });

  it("criar requisicao e recusada, e nada e criado", async () => {
    const estado = await criarRequisicaoAction({}, formularioDeRequisicao());

    expect(estado.erro).toBe(MENSAGEM_SEM_PERMISSAO);
    expect(estado.sucesso).toBeUndefined();
    expect(mocks.criarRequisicao).not.toHaveBeenCalled();
  });

  it("criar requisicao com a caixinha Substituir marcada e recusada, e nada e apagado", async () => {
    const dados = formularioDeRequisicao();
    dados.set("substituir", "sim");

    const estado = await criarRequisicaoAction({}, dados);

    expect(estado.erro).toBe(MENSAGEM_SEM_PERMISSAO);
    expect(estado.sucesso).toBeUndefined();
    expect(mocks.criarRequisicao).not.toHaveBeenCalled();
  });

  it("previa da substituicao e recusada — ela le guias e atendimentos do paciente", async () => {
    const resultado = await previsaoDeSubstituicaoAction({
      pacienteNome: "Fulano de Tal",
      numeroRequisicao: "123",
      terapiaIds: [1],
    });

    expect(resultado).toEqual({ ok: false, erro: MENSAGEM_SEM_PERMISSAO });
    expect(mocks.previsaoDeSubstituicao).not.toHaveBeenCalled();
  });

  it("criar/substituir encaminhamento e recusado, e nada e gravado", async () => {
    const estado = await criarEncaminhamentoAction(
      {},
      formularioDeEncaminhamento(),
    );

    expect(estado.erro).toBe(MENSAGEM_SEM_PERMISSAO);
    expect(estado.sucesso).toBeUndefined();
    expect(mocks.registrarEncaminhamento).not.toHaveBeenCalled();
  });

  it.each(["klini", "sulamerica"] as const)(
    "excluir paciente (Cadastro %s) e recusado, e a transacao nem comeca",
    async (convenio) => {
      const resultado = await excluirPaciente(3, convenio);

      expect(resultado).toEqual({ ok: false, erro: MENSAGEM_SEM_PERMISSAO });
      expect(mocks.excluirPacientePeloId).not.toHaveBeenCalled();
    },
  );

  it.each(["klini", "sulamerica"] as const)(
    "contar para excluir (Cadastro %s) e recusado — a contagem tambem le o prontuario",
    async (convenio) => {
      const resultado = await contarParaExcluirPaciente(3, convenio);

      expect(resultado).toEqual({ ok: false, erro: MENSAGEM_SEM_PERMISSAO });
      expect(mocks.contarParaExclusao).not.toHaveBeenCalled();
    },
  );

  it("remover encaminhamento e recusado, e nada e apagado", async () => {
    const resultado = await removerEncaminhamentoAction(3);

    expect(resultado).toEqual({ ok: false, erro: MENSAGEM_SEM_PERMISSAO });
    expect(mocks.removerEncaminhamento).not.toHaveBeenCalled();
  });
});

describe("admin chamando as mesmas actions", () => {
  beforeEach(() => {
    logadoComoPapelNoBanco("admin");
  });

  it("criar requisicao chega no dominio", async () => {
    mocks.criarRequisicao.mockResolvedValue({
      ok: true,
      pacienteNome: "Fulano de Tal",
      numeroRequisicao: "123",
      requisicaoCriada: true,
      terapiasAdicionadas: 1,
      terapiasAtualizadas: 0,
      substituidas: [],
      requisicoesApagadas: [],
    });

    const estado = await criarRequisicaoAction({}, formularioDeRequisicao());

    expect(estado.erro).toBeUndefined();
    expect(estado.sucesso?.numeroRequisicao).toBe("123");
    expect(mocks.criarRequisicao).toHaveBeenCalledOnce();
  });

  it("criar requisicao com Substituir marcada chega no dominio pedindo a substituicao", async () => {
    mocks.criarRequisicao.mockResolvedValue({
      ok: true,
      pacienteNome: "Fulano de Tal",
      numeroRequisicao: "123",
      requisicaoCriada: true,
      terapiasAdicionadas: 1,
      terapiasAtualizadas: 0,
      substituidas: [],
      requisicoesApagadas: [],
    });
    const dados = formularioDeRequisicao();
    dados.set("substituir", "sim");

    const estado = await criarRequisicaoAction({}, dados);

    expect(estado.erro).toBeUndefined();
    expect(mocks.criarRequisicao).toHaveBeenCalledWith(
      expect.objectContaining({ substituir: true }),
    );
  });

  it("previa da substituicao chega no dominio e devolve so os campos de texto", async () => {
    mocks.previsaoDeSubstituicao.mockResolvedValue([
      {
        guiaId: 5,
        terapiaId: 1,
        terapiaNome: "Fono",
        requisicaoId: 3,
        numeroRequisicao: "333",
        atendimentos: 12,
      },
    ]);

    const resultado = await previsaoDeSubstituicaoAction({
      pacienteNome: "Fulano de Tal",
      numeroRequisicao: "444",
      terapiaIds: [1],
    });

    expect(resultado).toEqual({
      ok: true,
      itens: [{ terapiaNome: "Fono", numeroRequisicao: "333", atendimentos: 12 }],
    });
    expect(mocks.previsaoDeSubstituicao).toHaveBeenCalledWith(
      "Fulano de Tal",
      [1],
      "444",
    );
  });

  it("criar encaminhamento chega no dominio", async () => {
    mocks.registrarEncaminhamento.mockResolvedValue({
      ok: true,
      pacienteNome: "Fulano de Tal",
      dataEncaminhamento: "2026-09-17",
      dataVencimento: "2027-03-16",
      substituiuAnterior: false,
    });

    const estado = await criarEncaminhamentoAction(
      {},
      formularioDeEncaminhamento(),
    );

    expect(estado.erro).toBeUndefined();
    expect(mocks.registrarEncaminhamento).toHaveBeenCalledOnce();
  });

  it("excluir paciente chega no dominio", async () => {
    mocks.excluirPacientePeloId.mockResolvedValue({
      ok: true,
      pacienteNome: "Fulano de Tal",
      requisicoes: 1,
      guias: 2,
      atendimentos: 3,
    });

    const resultado = await excluirPaciente(3, "klini");

    expect(resultado).toMatchObject({ ok: true });
    expect(mocks.excluirPacientePeloId).toHaveBeenCalledWith(3);
  });

  it("remover encaminhamento chega no dominio", async () => {
    mocks.removerEncaminhamento.mockResolvedValue({
      ok: true,
      pacienteNome: "Fulano de Tal",
    });

    const resultado = await removerEncaminhamentoAction(3);

    expect(resultado).toEqual({ ok: true, pacienteNome: "Fulano de Tal" });
    expect(mocks.removerEncaminhamento).toHaveBeenCalledWith(3);
  });
});

describe("plano para a Nova requisição — só leitura, só admin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("recepção (cookie dizendo admin) é recusada e o domínio nem é consultado", async () => {
    mocks.getSession.mockResolvedValue({ usuarioId: 7, papel: "admin" });
    mocks.findUnique.mockResolvedValue({
      id: 7,
      username: "quem-seja",
      ativo: true,
      papel: "recepcao",
    });

    const resultado = await planoParaRequisicaoAction("Fulano de Tal");

    expect(resultado).toEqual({ ok: false, erro: MENSAGEM_SEM_PERMISSAO });
    expect(mocks.planoParaRequisicao).not.toHaveBeenCalled();
  });

  it("admin recebe só terapiaId, nome e minutosSemanais, mesmo que o domínio devolva mais", async () => {
    logadoComoPapelNoBanco("admin");
    mocks.planoParaRequisicao.mockResolvedValue({
      encontrado: true,
      terapias: [
        {
          terapiaId: 1,
          nome: "Fono",
          minutosSemanais: 150,
          numeroCarteirinha: "ZZ99887766",
          crmMedico: "123456",
          nomeMedico: "Dra. Teste",
        },
      ],
      numeroCarteirinha: "ZZ99887766",
    });

    const resultado = await planoParaRequisicaoAction("Fulano de Tal");

    expect(resultado).toEqual({
      ok: true,
      encontrado: true,
      terapias: [{ terapiaId: 1, nome: "Fono", minutosSemanais: 150 }],
    });
    expect(JSON.stringify(resultado)).not.toMatch(
      /ZZ99887766|123456|Dra\. Teste|carteirinha|crm|medico/i,
    );
    expect(mocks.planoParaRequisicao).toHaveBeenCalledWith("Fulano de Tal");
  });

  it("nome de ninguém volta só `encontrado: false`, sem eco do nome", async () => {
    logadoComoPapelNoBanco("admin");
    mocks.planoParaRequisicao.mockResolvedValue({ encontrado: false });

    const resultado = await planoParaRequisicaoAction("Nome Secreto Qualquer");

    expect(resultado).toEqual({ ok: true, encontrado: false });
    expect(JSON.stringify(resultado)).not.toContain("Nome Secreto");
  });

  it("argumento que não é texto (POST montado à mão) vira nome vazio", async () => {
    logadoComoPapelNoBanco("admin");
    mocks.planoParaRequisicao.mockResolvedValue({ encontrado: false });

    await planoParaRequisicaoAction({ nome: "x" } as unknown as string);

    expect(mocks.planoParaRequisicao).toHaveBeenCalledWith("");
  });
});

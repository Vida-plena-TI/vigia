/**
 * "Nova requisição" puxa o plano do paciente (regra 26).
 *
 * Integração contra o Postgres, tudo em rollback: a leitura
 * (`planoParaRequisicaoComCliente`) devolve o plano certo, `[]` para quem não
 * tem plano, a mesma resposta para nome de ninguém e para paciente sem
 * encaminhamento, e nunca carteirinha, CRM ou nome do médico. E o fluxo
 * inteiro como a tela faria: Cadastro (com plano) → Encaminhamento → ler o
 * plano → linhas preenchidas → remover uma → criar a requisição com as que
 * sobraram, inclusive com a caixinha "Substituir" marcada.
 *
 * As linhas da tela vêm das mesmas funções puras do formulário
 * (`preenchimento-do-plano.ts`); só o clique fica para o navegador.
 */
import { describe, expect, it } from "vitest";

import { getPrismaClient } from "@/lib/db";
import {
  linhaNova,
  linhasDoPlano,
  QTD_AUTORIZADA_PADRAO,
  type LinhaDoFormulario,
} from "@/app/(app)/klini/requisicoes/nova/preenchimento-do-plano";

import { registrarEncaminhamentoNaTransacao } from "./encaminhamentos";
import {
  cadastrarPacienteNaTransacao,
  planoParaRequisicaoComCliente,
} from "./plano-terapias";
import {
  criarRequisicaoNaTransacao,
  ERRO_PACIENTE_NAO_CADASTRADO,
  ERRO_SEM_ENCAMINHAMENTO,
  previsaoDeSubstituicaoComCliente,
  validadePadraoDeGuia,
} from "./requisicoes";
import { dataDeHoje } from "./atendimentos";

const temBanco = Boolean(process.env.DATABASE_URL);

const SUFIXO = Math.random().toString(36).slice(2, 10);

function carteirinhaDeTeste(): string {
  return `T${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

class Rollback<T> extends Error {
  constructor(readonly dados: T) {
    super("rollback proposital do teste de integracao");
  }
}

type ClienteDaTransacao = Parameters<
  Parameters<ReturnType<typeof getPrismaClient>["$transaction"]>[0]
>[0];

async function comRollback<T>(
  executar: (tx: ClienteDaTransacao) => Promise<T>,
  isolamento?: "RepeatableRead",
): Promise<T> {
  try {
    await getPrismaClient().$transaction(
      async (tx) => {
        throw new Rollback(await executar(tx));
      },
      { maxWait: 30_000, timeout: 30_000, isolationLevel: isolamento },
    );
  } catch (erro) {
    if (erro instanceof Rollback) {
      return erro.dados as T;
    }
    throw erro;
  }

  throw new Error("a transacao deveria ter sofrido rollback");
}

/** Duas terapias descartáveis, com nomes que ordenam Fono antes de TO. */
async function criarFonoETo(
  tx: ClienteDaTransacao,
): Promise<{ fono: number; to: number; nomeFono: string; nomeTo: string }> {
  const nomeFono = `Fono Plano ${SUFIXO}`;
  const nomeTo = `TO Plano ${SUFIXO}`;
  const fono = await tx.terapia.create({
    data: { nome: nomeFono, codigoTiss: "PF" },
    select: { id: true },
  });
  const to = await tx.terapia.create({
    data: { nome: nomeTo, codigoTiss: "PT" },
    select: { id: true },
  });

  return { fono: fono.id, to: to.id, nomeFono, nomeTo };
}

/** Cadastro pela porta de entrada de verdade, com o plano dado. */
async function cadastrar(
  tx: ClienteDaTransacao,
  nome: string,
  terapias: { terapiaId: number; horas: string }[],
): Promise<number> {
  const resultado = await cadastrarPacienteNaTransacao(tx, {
    nome,
    convenio: "klini",
    terapias,
  });

  if (!resultado.ok) {
    throw new Error(`preparo do cadastro falhou: ${resultado.erro}`);
  }

  return resultado.pacienteId;
}

async function encaminhar(tx: ClienteDaTransacao, nome: string): Promise<void> {
  const resultado = await registrarEncaminhamentoNaTransacao(tx, {
    pacienteNome: nome,
    dataEncaminhamento: await dataDeHoje(),
    numeroCarteirinha: carteirinhaDeTeste(),
    crmMedico: "123456",
  });

  if (!resultado.ok) {
    throw new Error(`preparo do encaminhamento falhou: ${resultado.erro}`);
  }
}

/** As linhas que a tela mostraria logo depois do preenchimento. */
function linhasPreenchidas(
  terapias: { terapiaId: number; nome: string; minutosSemanais: number }[],
  validadePadrao: string,
): LinhaDoFormulario[] {
  let chave = 1;

  return linhasDoPlano(terapias, validadePadrao, [0], () => chave++);
}

/** O que o formulário envia a partir das linhas (o mesmo que o `getAll` lê). */
function linhasParaEnvio(linhas: LinhaDoFormulario[]) {
  return linhas.map((linha) => ({
    terapiaId: Number(linha.terapiaId),
    qtdAutorizada: Number(linha.qtdAutorizada),
    validade: linha.validade === "" ? null : linha.validade,
  }));
}

describe.skipIf(!temBanco)("Nova requisição puxa o plano do paciente", () => {
  it("devolve as terapias do plano, em ordem de nome, com os minutos gravados", async () => {
    const resultado = await comRollback(async (tx) => {
      const { fono, to, nomeFono, nomeTo } = await criarFonoETo(tx);
      const nome = `Paciente Plano ${SUFIXO}`;
      // Cadastrado com TO primeiro: a ordem da resposta é a do nome.
      await cadastrar(tx, nome, [
        { terapiaId: to, horas: "1" },
        { terapiaId: fono, horas: "2,5" },
      ]);
      await encaminhar(tx, nome);

      // Caixa e espaços diferentes casam com o mesmo paciente.
      const plano = await planoParaRequisicaoComCliente(
        tx,
        `  ${nome.toUpperCase()} `,
      );

      return { plano, fono, to, nomeFono, nomeTo };
    });

    expect(resultado.plano).toEqual({
      encontrado: true,
      terapias: [
        {
          terapiaId: resultado.fono,
          nome: resultado.nomeFono,
          minutosSemanais: 150,
        },
        { terapiaId: resultado.to, nome: resultado.nomeTo, minutosSemanais: 60 },
      ],
    });
  });

  it("paciente com encaminhamento e sem plano (legado) recebe lista vazia", async () => {
    const plano = await comRollback(async (tx) => {
      const nome = `Paciente Sem Plano ${SUFIXO}`;
      const { fono } = await criarFonoETo(tx);
      const id = await cadastrar(tx, nome, [{ terapiaId: fono, horas: "1" }]);
      await encaminhar(tx, nome);
      // O Cadastro exige uma terapia; o legado é quem nasceu antes do plano.
      await tx.$executeRaw`DELETE FROM "plano_terapia" WHERE "paciente_id" = ${id}`;

      return planoParaRequisicaoComCliente(tx, nome);
    });

    expect(plano).toEqual({ encontrado: true, terapias: [] });
  });

  it("nome de ninguém não cria paciente e responde igual a paciente sem encaminhamento", async () => {
    const resultado = await comRollback(async (tx) => {
      const contar = async () =>
        Number(
          (
            await tx.$queryRaw<{ total: bigint }[]>`
              SELECT count(*) AS "total" FROM "paciente"
            `
          )[0].total,
        );

      const antes = await contar();
      const inexistente = await planoParaRequisicaoComCliente(
        tx,
        `Ninguem Com Este Nome ${SUFIXO}`,
      );
      const vazio = await planoParaRequisicaoComCliente(tx, "   ");
      const depois = await contar();

      // Paciente cadastrado, com plano, mas sem encaminhamento.
      const { fono } = await criarFonoETo(tx);
      const nome = `Paciente Sem Encaminhamento ${SUFIXO}`;
      await cadastrar(tx, nome, [{ terapiaId: fono, horas: "2" }]);
      const semEncaminhamento = await planoParaRequisicaoComCliente(tx, nome);

      return { antes, depois, inexistente, vazio, semEncaminhamento };
    }, "RepeatableRead");

    expect(resultado.depois).toBe(resultado.antes);
    expect(resultado.inexistente).toEqual({ encontrado: false });
    expect(resultado.vazio).toEqual({ encontrado: false });
    // A mesma resposta: a leitura não diz se o nome é de um paciente.
    expect(resultado.semEncaminhamento).toEqual(resultado.inexistente);
  });

  it("a resposta nunca traz carteirinha, CRM nem nome do médico", async () => {
    const carteirinha = `ZQ${SUFIXO.toUpperCase()}77`;
    const crm = "9081726";
    const medico = `Dra. Vazamento ${SUFIXO}`;

    const plano = await comRollback(async (tx) => {
      const { fono } = await criarFonoETo(tx);
      const nome = `Paciente Sigilo ${SUFIXO}`;
      const id = await cadastrar(tx, nome, [{ terapiaId: fono, horas: "1" }]);
      await encaminhar(tx, nome);
      await tx.$executeRaw`
        UPDATE "paciente"
        SET "numero_carteirinha" = ${carteirinha}, "crm_medico" = ${crm}
        WHERE "id" = ${id}
      `;
      // Sintético: um paciente Klini não teria autorização SulAmérica pela
      // tela; aqui é só para haver um nome de médico gravado que poderia vazar.
      await tx.$executeRaw`
        INSERT INTO "autorizacao_sulamerica" ("paciente_id", "data_inicio", "prazo_meses", "nome_medico")
        VALUES (${id}, CURRENT_DATE, 3, ${medico})
      `;

      return planoParaRequisicaoComCliente(tx, nome);
    });

    const texto = JSON.stringify(plano);

    expect(plano.encontrado).toBe(true);
    expect(texto).not.toContain(carteirinha);
    expect(texto).not.toContain(crm);
    expect(texto).not.toContain(medico);
    expect(texto).not.toMatch(/carteirinha|crm|medico/i);

    if (plano.encontrado) {
      for (const terapia of plano.terapias) {
        expect(Object.keys(terapia).sort()).toEqual([
          "minutosSemanais",
          "nome",
          "terapiaId",
        ]);
      }
    }
  });

  it("fluxo: Cadastro (Fono 2 h, TO 1 h) → Encaminhamento → plano → linhas Fono 8 e TO 4 → requisição com essas quantidades", async () => {
    const resultado = await comRollback(async (tx) => {
      const { fono, to } = await criarFonoETo(tx);
      const nome = `Paciente Fluxo Plano ${SUFIXO}`;
      const validadePadrao = await validadePadraoDeGuia();

      await cadastrar(tx, nome, [
        { terapiaId: fono, horas: "2" },
        { terapiaId: to, horas: "1" },
      ]);

      // Antes do encaminhamento: nada a preencher, e a criação recusa como sempre.
      const antes = await planoParaRequisicaoComCliente(tx, nome);
      const recusa = await criarRequisicaoNaTransacao(tx, {
        pacienteNome: nome,
        numeroRequisicao: `PL-${SUFIXO}`,
        linhas: [{ terapiaId: fono, qtdAutorizada: 4, validade: null }],
      });

      await encaminhar(tx, nome);
      const plano = await planoParaRequisicaoComCliente(tx, nome);

      if (!plano.encontrado) {
        throw new Error("o plano deveria ter sido encontrado");
      }

      // Linhas como a tela as preenche, enviadas sem mexer.
      const linhas = linhasPreenchidas(plano.terapias, validadePadrao);

      const criada = await criarRequisicaoNaTransacao(tx, {
        pacienteNome: nome,
        numeroRequisicao: `PL-${SUFIXO}`,
        linhas: linhasParaEnvio(linhas),
      });

      const guias = await tx.$queryRaw<
        { terapiaId: number; qtdAutorizada: number; validade: string | null }[]
      >`
        SELECT rt."terapia_id" AS "terapiaId", rt."qtd_autorizada" AS "qtdAutorizada",
               rt."validade"::text AS "validade"
        FROM "requisicao_terapia" rt
        JOIN "requisicao" r ON r."id" = rt."requisicao_id"
        JOIN "paciente" p ON p."id" = r."paciente_id"
        WHERE lower(p."nome") = lower(${nome})
        ORDER BY rt."terapia_id"
      `;

      return { antes, recusa, plano, linhas, criada, guias, fono, to, validadePadrao };
    });

    expect(resultado.antes).toEqual({ encontrado: false });
    expect(resultado.recusa).toEqual({ ok: false, erro: ERRO_SEM_ENCAMINHAMENTO });
    expect(resultado.plano.encontrado).toBe(true);
    expect(
      resultado.linhas.map((linha) => [linha.terapiaId, linha.qtdAutorizada]),
    ).toEqual([
      [String(resultado.fono), "8"],
      [String(resultado.to), "4"],
    ]);
    expect(resultado.criada).toMatchObject({
      ok: true,
      requisicaoCriada: true,
      terapiasAdicionadas: 2,
    });
    // A quantidade gravada é a que o formulário enviou (a sugerida); a
    // validade é a padrão. Nada do plano é gravado além disso.
    expect(resultado.guias).toEqual([
      {
        terapiaId: resultado.fono,
        qtdAutorizada: 8,
        validade: resultado.validadePadrao,
      },
      {
        terapiaId: resultado.to,
        qtdAutorizada: 4,
        validade: resultado.validadePadrao,
      },
    ]);
  });

  it("plano com Fono + TO, remover TO, marcar Substituir: a prévia e a gravação só tocam a Fono", async () => {
    const resultado = await comRollback(async (tx) => {
      const { fono, to, nomeFono } = await criarFonoETo(tx);
      const nome = `Paciente Substitui Plano ${SUFIXO}`;
      const validadePadrao = await validadePadraoDeGuia();

      await cadastrar(tx, nome, [
        { terapiaId: fono, horas: "2" },
        { terapiaId: to, horas: "1" },
      ]);
      await encaminhar(tx, nome);

      // Requisição antiga 333 com Fono + TO e atendimentos nas duas.
      const antiga = await criarRequisicaoNaTransacao(tx, {
        pacienteNome: nome,
        numeroRequisicao: `333-${SUFIXO}`,
        linhas: [
          { terapiaId: fono, qtdAutorizada: 8, validade: null },
          { terapiaId: to, qtdAutorizada: 8, validade: null },
        ],
      });

      if (!antiga.ok) {
        throw new Error(`preparo da requisição antiga falhou: ${antiga.erro}`);
      }

      const guiasAntigas = await tx.requisicaoTerapia.findMany({
        where: { requisicao: { numeroRequisicao: `333-${SUFIXO}` } },
        select: { id: true, terapiaId: true },
      });

      for (const guia of guiasAntigas) {
        for (let vez = 0; vez < 2; vez += 1) {
          await tx.atendimento.create({
            data: {
              requisicaoTerapiaId: guia.id,
              dataAtendimento: new Date("2026-10-01T00:00:00Z"),
              creditosConsumidos: 1,
            },
          });
        }
      }

      const plano = await planoParaRequisicaoComCliente(tx, nome);

      if (!plano.encontrado) {
        throw new Error("o plano deveria ter sido encontrado");
      }

      const linhas = linhasPreenchidas(plano.terapias, validadePadrao).filter(
        (linha) => linha.terapiaId !== String(to),
      );
      const envio = linhasParaEnvio(linhas);

      // O que o diálogo mostraria.
      const previa = await previsaoDeSubstituicaoComCliente(
        tx,
        nome,
        envio.map((linha) => linha.terapiaId),
        `444-${SUFIXO}`,
      );

      // "Substituir e apagar" confirmado: o envio com a caixinha marcada.
      const criada = await criarRequisicaoNaTransacao(tx, {
        pacienteNome: nome,
        numeroRequisicao: `444-${SUFIXO}`,
        linhas: envio,
        substituir: true,
      });

      const depois = await tx.$queryRaw<
        { numero: string; terapiaId: number; qtd: number; atendimentos: number }[]
      >`
        SELECT r."numero_requisicao" AS "numero", rt."terapia_id" AS "terapiaId",
               rt."qtd_autorizada" AS "qtd",
               (SELECT count(*)::int FROM "atendimento" a
                WHERE a."requisicao_terapia_id" = rt."id") AS "atendimentos"
        FROM "requisicao_terapia" rt
        JOIN "requisicao" r ON r."id" = rt."requisicao_id"
        JOIN "paciente" p ON p."id" = r."paciente_id"
        WHERE lower(p."nome") = lower(${nome})
        ORDER BY r."numero_requisicao", rt."terapia_id"
      `;

      return { previa, criada, depois, fono, to, nomeFono };
    });

    expect(resultado.previa).toHaveLength(1);
    expect(resultado.previa[0]).toMatchObject({
      terapiaNome: resultado.nomeFono,
      numeroRequisicao: `333-${SUFIXO}`,
      atendimentos: 2,
    });
    expect(resultado.criada).toMatchObject({ ok: true, requisicaoCriada: true });
    if (resultado.criada.ok) {
      expect(resultado.criada.substituidas).toEqual([
        expect.objectContaining({
          terapiaNome: resultado.nomeFono,
          numeroRequisicao: `333-${SUFIXO}`,
          atendimentos: 2,
        }),
      ]);
      expect(resultado.criada.requisicoesApagadas).toEqual([]);
    }
    // 333 fica só com a TO (e os atendimentos dela); 444 nasce com a Fono.
    expect(resultado.depois).toEqual([
      { numero: `333-${SUFIXO}`, terapiaId: resultado.to, qtd: 8, atendimentos: 2 },
      // Fono 2 h no plano → a linha sugerida 8, enviada sem edição.
      { numero: `444-${SUFIXO}`, terapiaId: resultado.fono, qtd: 8, atendimentos: 0 },
    ]);
  });

  it("linha nova do formulário e linha do plano nascem com a mesma validade; só a quantidade difere", async () => {
    const validadePadrao = await validadePadraoDeGuia();
    const [doPlano] = linhasPreenchidas(
      [{ terapiaId: 7, nome: "Fono", minutosSemanais: 9_000 }],
      validadePadrao,
    );
    const nova = linhaNova(5, validadePadrao);

    expect(doPlano.validade).toBe(nova.validade);
    // 9000 min = 150 h cheias → 150 por semana → 600 no mês; a linha à mão fica em 4.
    expect(doPlano.qtdAutorizada).toBe("600");
    expect(nova.qtdAutorizada).toBe(QTD_AUTORIZADA_PADRAO);
  });

  it("nome inexistente continua recusado pela criação, com a mensagem de sempre", async () => {
    const recusa = await comRollback((tx) =>
      criarRequisicaoNaTransacao(tx, {
        pacienteNome: `Ninguem Plano ${SUFIXO}`,
        numeroRequisicao: "1",
        linhas: [{ terapiaId: 1, qtdAutorizada: 4, validade: null }],
      }),
    );

    expect(recusa).toEqual({ ok: false, erro: ERRO_PACIENTE_NAO_CADASTRADO });
  });
});

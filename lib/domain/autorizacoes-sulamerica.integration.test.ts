import { afterAll, describe, expect, it } from "vitest";
import { getPrismaClient } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  excluirAutorizacaoComCliente, listarAutorizacoesComCliente, registrarAutorizacao,
  registrarAutorizacaoNaTransacao, type EntradaAutorizacao,
} from "./autorizacoes-sulamerica";
import { ERRO_PRAZO_INVALIDO } from "./autorizacoes-sulamerica-mensagens";
import {
  ERRO_CARTEIRINHA_OBRIGATORIA, ERRO_CARTEIRINHA_OBRIGATORIA_SEM_CADASTRO, erroCarteirinhaDeOutroPaciente,
} from "./carteirinha-crm";
import { registrarEncaminhamentoNaTransacao } from "./encaminhamentos";
import { ERRO_NOME_MEDICO_INVALIDO, ERRO_NOME_MEDICO_OBRIGATORIO } from "./nome-medico";
import { excluirPacienteNaTransacao } from "./pacientes";

class Rollback<T> extends Error { constructor(readonly resultado: T) { super("rollback de teste"); } }
async function comRollback<T>(executar: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try {
    await getPrismaClient().$transaction(async (tx) => {
      throw new Rollback(await executar(tx));
    }, { maxWait: 30000, timeout: 30000 });
  } catch (erro) {
    if (erro instanceof Rollback) return erro.resultado as T;
    throw erro;
  }
  throw new Error("faltou rollback");
}
const nome = () => `Teste SulAmérica ${crypto.randomUUID()}`;
/** Sintética, única por chamada, só letras/dígitos. */
const carteirinha = () => `S${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
function entrada(pacienteNome: string, campos: Partial<EntradaAutorizacao> = {}): EntradaAutorizacao {
  return {
    pacienteNome, dataInicio: "2026-01-31", prazoMeses: 3,
    numeroCarteirinha: carteirinha(), crmMedico: "123456", nomeMedico: "Dra. Teste", ...campos,
  };
}
async function registrar(tx: Prisma.TransactionClient, pacienteNome: string, dataInicio = "2026-01-31", prazoMeses = 3) {
  const resultado = await registrarAutorizacaoNaTransacao(tx, entrada(pacienteNome, { dataInicio, prazoMeses }));
  if (!resultado.ok) throw new Error(resultado.erro);
  return resultado;
}
type Gravado = { pacientes: number; autorizacoes: number; carteirinha: string | null; crm: string | null; medico: string | null };
/** O que ficou no banco para o paciente de nome `pacienteNome` (sem caixa). */
async function gravado(tx: Prisma.TransactionClient, pacienteNome: string): Promise<Gravado> {
  const [linha] = await tx.$queryRaw<Gravado[]>`
    SELECT count(DISTINCT p.id)::int AS pacientes, count(a.id)::int AS autorizacoes,
      max(p.numero_carteirinha) AS carteirinha, max(p.crm_medico) AS crm, max(a.nome_medico) AS medico
    FROM paciente p LEFT JOIN autorizacao_sulamerica a ON a.paciente_id = p.id
    WHERE lower(p.nome) = lower(${pacienteNome})
  `;
  return linha;
}

describe.skipIf(!process.env.DATABASE_URL)("SulAmérica contra Postgres real", () => {
  afterAll(async () => { await getPrismaClient().$disconnect(); });

  // Expectativas literais: não repetir o cálculo que está sendo testado.
  it.each([
    ["2026-01-15", 3, "2026-04-15"],
    ["2026-01-15", 6, "2026-07-15"],
    ["2026-01-15", 12, "2027-01-15"],
    ["2026-01-31", 3, "2026-04-30"],
    ["2026-08-31", 6, "2027-02-28"],
    ["2027-08-31", 6, "2028-02-29"],
    ["2028-02-29", 12, "2029-02-28"],
    ["2026-11-30", 3, "2027-02-28"],
  ])("%s + %i meses vence em %s", async (data, prazo, esperado) => {
    const resultado = await comRollback(tx => registrar(tx, nome(), String(data), Number(prazo)));
    expect(resultado.dataVencimento).toBe(esperado);
  });

  it("upsert reaproveita paciente sem distinguir caixa e substitui data e prazo", async () => {
    await comRollback(async tx => {
      const pacienteNome = nome();
      const primeiro = await registrar(tx, pacienteNome);
      const segundo = await registrar(tx, ` ${pacienteNome.toUpperCase()} `, "2026-08-31", 6);
      expect(primeiro).toMatchObject({ pacienteCriado: true, substituiuAnterior: false });
      expect(segundo).toMatchObject({ id: primeiro.id, pacienteNome, pacienteCriado: false,
        substituiuAnterior: true, dataInicio: "2026-08-31", prazoMeses: 6, dataVencimento: "2027-02-28" });
      expect(await tx.autorizacaoSulamerica.count({ where: { paciente: { nome: pacienteNome } } })).toBe(1);
    });
  });

  async function cenarioCompleto(tx: Prisma.TransactionClient) {
    const autorizacao = await registrar(tx, nome());
    const linha = await tx.autorizacaoSulamerica.findUniqueOrThrow({ where: { id: autorizacao.id } });
    const pacienteId = linha.pacienteId;
    const encaminhamento = await tx.encaminhamento.create({ data: { pacienteId, dataEncaminhamento: new Date("2026-01-01") } });
    const terapia = await tx.terapia.create({ data: { nome: nome(), codigoTiss: "teste" } });
    const requisicao = await tx.requisicao.create({ data: { pacienteId, numeroRequisicao: "sul-teste", situacao: "aprovada" } });
    const guia = await tx.requisicaoTerapia.create({ data: { requisicaoId: requisicao.id, terapiaId: terapia.id, qtdAutorizada: 8 } });
    const atendimento = await tx.atendimento.create({ data: { requisicaoTerapiaId: guia.id, dataAtendimento: new Date("2026-01-01") } });
    return { autorizacao, pacienteId, encaminhamento, terapia, requisicao, guia, atendimento };
  }

  it("excluir autorização mantém paciente, encaminhamento, requisição, guia e atendimento", async () => {
    await comRollback(async tx => {
      const c = await cenarioCompleto(tx);
      expect(await excluirAutorizacaoComCliente(tx, c.autorizacao.id)).toEqual({ ok: true });
      expect(await tx.autorizacaoSulamerica.findUnique({ where: { id: c.autorizacao.id } })).toBeNull();
      expect(await tx.paciente.findUnique({ where: { id: c.pacienteId } })).not.toBeNull();
      expect(await tx.encaminhamento.findUnique({ where: { id: c.encaminhamento.id } })).not.toBeNull();
      expect(await tx.requisicao.findUnique({ where: { id: c.requisicao.id } })).not.toBeNull();
      expect(await tx.requisicaoTerapia.findUnique({ where: { id: c.guia.id } })).not.toBeNull();
      expect(await tx.atendimento.findUnique({ where: { id: c.atendimento.id } })).not.toBeNull();
      expect(await excluirAutorizacaoComCliente(tx, c.autorizacao.id)).toMatchObject({ ok: false });
    });
  });

  it("exclusão completa pelo Klini continua funcionando quando há SulAmérica", async () => {
    await comRollback(async tx => {
      const c = await cenarioCompleto(tx);
      expect(await excluirPacienteNaTransacao(tx, c.pacienteId)).toMatchObject({ ok: true });
      expect(await tx.autorizacaoSulamerica.findUnique({ where: { id: c.autorizacao.id } })).toBeNull();
      expect(await tx.paciente.findUnique({ where: { id: c.pacienteId } })).toBeNull();
      expect(await tx.atendimento.findUnique({ where: { id: c.atendimento.id } })).toBeNull();
    });
  });

  it.each([0, 1, 4, 9, -3, 24])("CHECK do banco recusa prazo %i mesmo sem domínio", async prazo => {
    await expect(comRollback(async tx => {
      const p = await tx.paciente.create({ data: { nome: nome() } });
      await tx.$executeRaw`INSERT INTO autorizacao_sulamerica (paciente_id, data_inicio, prazo_meses)
        VALUES (${p.id}, '2026-01-01'::date, ${prazo})`;
    })).rejects.toThrow(/23514|check constraint|prazo_meses_check/i);
  });

  it("banco recusa escrita na coluna gerada", async () => {
    await expect(comRollback(async tx => {
      const a = await registrar(tx, nome());
      await tx.$executeRaw`UPDATE autorizacao_sulamerica SET data_vencimento = '2027-01-01'::date WHERE id = ${a.id}`;
    })).rejects.toThrow(/428C9|generated column|data_vencimento/i);
  });

  it("banco recusa INSERT com valor na coluna gerada, mesmo com nome do médico", async () => {
    await expect(comRollback(async tx => {
      const p = await tx.paciente.create({ data: { nome: nome() } });
      await tx.$executeRaw`INSERT INTO autorizacao_sulamerica (paciente_id, data_inicio, prazo_meses, nome_medico, data_vencimento)
        VALUES (${p.id}, '2026-01-01'::date, 3, 'Dra. Teste', '2026-04-01'::date)`;
    })).rejects.toThrow(/428C9|generated column|data_vencimento/i);
  });

  describe("encaminhamento SulAmérica: carteirinha, CRM e nome do médico", () => {
    it("paciente novo nasce com autorização, carteirinha, CRM e médico na mesma transação", async () => {
      await comRollback(async tx => {
        const pacienteNome = nome();
        const numero = carteirinha();
        const resultado = await registrarAutorizacaoNaTransacao(tx, entrada(pacienteNome, {
          numeroCarteirinha: ` ${numero.slice(0, 5)} ${numero.slice(5)} `, crmMedico: "123.456",
          nomeMedico: "  Dr.  João   D'Ávila-Silva ",
        }));
        expect(resultado).toMatchObject({ ok: true, pacienteCriado: true, substituiuAnterior: false });
        expect(await gravado(tx, pacienteNome)).toEqual({
          pacientes: 1, autorizacoes: 1, carteirinha: numero, crm: "123456", medico: "Dr. João D'Ávila-Silva",
        });
        // O sucesso não devolve os números nem o médico.
        const texto = JSON.stringify(resultado);
        expect(texto).not.toContain(numero);
        expect(texto).not.toContain("123456");
        expect(texto).not.toContain("Ávila");
      });
    });

    it("reenvio substitui a autorização e atualiza CRM e médico, sem duplicar paciente", async () => {
      await comRollback(async tx => {
        const pacienteNome = nome();
        const numero = carteirinha();
        const primeiro = await registrarAutorizacaoNaTransacao(tx, entrada(pacienteNome, { numeroCarteirinha: numero }));
        const segundo = await registrarAutorizacaoNaTransacao(tx, entrada(pacienteNome.toUpperCase(), {
          numeroCarteirinha: numero, dataInicio: "2026-08-31", prazoMeses: 6, crmMedico: "999", nomeMedico: "Dr. Outro",
        }));
        expect(segundo).toMatchObject({ ok: true, pacienteCriado: false, substituiuAnterior: true,
          dataInicio: "2026-08-31", prazoMeses: 6, dataVencimento: "2027-02-28" });
        if (primeiro.ok && segundo.ok) expect(segundo.id).toBe(primeiro.id);
        expect(await gravado(tx, pacienteNome)).toEqual({
          pacientes: 1, autorizacoes: 1, carteirinha: numero, crm: "999", medico: "Dr. Outro",
        });
      });
    });

    it.each(["", "   ", "\u00a0"])("reenvio com carteirinha %j mantém a cadastrada", async branco => {
      await comRollback(async tx => {
        const pacienteNome = nome();
        const numero = carteirinha();
        await registrarAutorizacaoNaTransacao(tx, entrada(pacienteNome, { numeroCarteirinha: numero }));
        const reenvio = await registrarAutorizacaoNaTransacao(tx, entrada(pacienteNome, {
          numeroCarteirinha: branco, crmMedico: "777",
        }));
        expect(reenvio).toMatchObject({ ok: true, substituiuAnterior: true });
        expect(await gravado(tx, pacienteNome)).toMatchObject({ pacientes: 1, autorizacoes: 1, carteirinha: numero, crm: "777" });
      });
    });

    it.each(["", "   "])("paciente novo com carteirinha %j é recusado", async branco => {
      await comRollback(async tx => {
        const pacienteNome = nome();
        const resultado = await registrarAutorizacaoNaTransacao(tx, entrada(pacienteNome, { numeroCarteirinha: branco }));
        expect(resultado).toEqual({ ok: false, erro: ERRO_CARTEIRINHA_OBRIGATORIA });
      });
    });

    it.each(["", "   "])("paciente existente sem carteirinha com campo %j é recusado, nada gravado", async branco => {
      await comRollback(async tx => {
        const pacienteNome = nome();
        await tx.paciente.create({ data: { nome: pacienteNome } });
        const resultado = await registrarAutorizacaoNaTransacao(tx, entrada(pacienteNome, { numeroCarteirinha: branco }));
        expect(resultado).toEqual({ ok: false, erro: ERRO_CARTEIRINHA_OBRIGATORIA_SEM_CADASTRO });
        expect(await gravado(tx, pacienteNome)).toEqual({
          pacientes: 1, autorizacoes: 0, carteirinha: null, crm: null, medico: null,
        });
      });
    });

    it.each([
      ["ausente", undefined, ERRO_NOME_MEDICO_OBRIGATORIO],
      ["só espaços", "    ", ERRO_NOME_MEDICO_OBRIGATORIO],
      ["com 2 caracteres", "Jo", ERRO_NOME_MEDICO_INVALIDO],
      ["com 121 caracteres", "a".repeat(121), ERRO_NOME_MEDICO_INVALIDO],
      ["só dígitos", "123456", ERRO_NOME_MEDICO_INVALIDO],
    ])("nome do médico %s é recusado sem gravar nada", async (_caso, nomeMedico, erro) => {
      await comRollback(async tx => {
        const pacienteNome = nome();
        const resultado = await registrarAutorizacaoNaTransacao(tx, entrada(pacienteNome, { nomeMedico: nomeMedico as string }));
        expect(resultado).toEqual({ ok: false, erro });
        expect(await gravado(tx, pacienteNome)).toMatchObject({ pacientes: 0, autorizacoes: 0 });
      });
    });

    it.each([0, 1, 4, 24])("prazo %i é recusado pelo domínio sem criar paciente", async prazoMeses => {
      await comRollback(async tx => {
        const pacienteNome = nome();
        expect(await registrarAutorizacaoNaTransacao(tx, entrada(pacienteNome, { prazoMeses })))
          .toEqual({ ok: false, erro: ERRO_PRAZO_INVALIDO });
        expect(await gravado(tx, pacienteNome)).toMatchObject({ pacientes: 0 });
      });
    });

    it.each([["''", ""], ["'ab'", "ab"], ["'  a  '", "  a  "], ["121", "x".repeat(121)]])(
      "CHECK do banco recusa nome_medico %s mesmo sem domínio", async (_caso, valor) => {
        await expect(comRollback(async tx => {
          const p = await tx.paciente.create({ data: { nome: nome() } });
          await tx.$executeRaw`INSERT INTO autorizacao_sulamerica (paciente_id, data_inicio, prazo_meses, nome_medico)
            VALUES (${p.id}, '2026-01-01'::date, 3, ${valor})`;
        })).rejects.toThrow(/23514|check constraint|nome_medico_tamanho/i);
      },
    );

    it("CHECK do banco aceita NULL (legado) e 3 caracteres", async () => {
      await comRollback(async tx => {
        for (const valor of [null, "Ana"]) {
          const p = await tx.paciente.create({ data: { nome: nome() } });
          await tx.$executeRaw`INSERT INTO autorizacao_sulamerica (paciente_id, data_inicio, prazo_meses, nome_medico)
            VALUES (${p.id}, '2026-01-01'::date, 3, ${valor})`;
        }
      });
    });

    it("carteirinha de paciente da Klini, digitada para outro paciente na SulAmérica, é recusada com o nome do dono", async () => {
      await comRollback(async tx => {
        const donoNome = nome();
        const numero = carteirinha();
        const klini = await registrarEncaminhamentoNaTransacao(tx, {
          pacienteNome: donoNome, dataEncaminhamento: "2026-10-01", numeroCarteirinha: numero, crmMedico: "1",
        });
        expect(klini.ok).toBe(true);
        const outro = nome();
        const resultado = await registrarAutorizacaoNaTransacao(tx, entrada(outro, { numeroCarteirinha: numero.toLowerCase() }));
        expect(resultado).toEqual({ ok: false, erro: erroCarteirinhaDeOutroPaciente(donoNome) });
        if (!resultado.ok) expect(resultado.erro).not.toContain(numero);
        expect(await gravado(tx, donoNome)).toMatchObject({ carteirinha: numero, crm: "1", autorizacoes: 0 });
      });
    });

    it("paciente da Klini cadastrado na SulAmérica compartilha carteirinha e CRM (limite conhecido)", async () => {
      await comRollback(async tx => {
        const pacienteNome = nome();
        const numero = carteirinha();
        await registrarEncaminhamentoNaTransacao(tx, {
          pacienteNome, dataEncaminhamento: "2026-10-01", numeroCarteirinha: numero, crmMedico: "111",
        });
        const resultado = await registrarAutorizacaoNaTransacao(tx, entrada(pacienteNome, { numeroCarteirinha: "", crmMedico: "222" }));
        expect(resultado).toMatchObject({ ok: true, pacienteCriado: false, substituiuAnterior: false });
        // Carteirinha em branco mantém a da Klini; o CRM passa a ser o da SulAmérica, para os dois.
        expect(await gravado(tx, pacienteNome)).toMatchObject({ pacientes: 1, autorizacoes: 1, carteirinha: numero, crm: "222" });
        const [e] = await tx.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM encaminhamento e JOIN paciente p ON p.id = e.paciente_id WHERE p.nome = ${pacienteNome}`;
        expect(e.n).toBe(1);
      });
    });

    it("erro inesperado do banco no upsert escapa sem o nome do médico", async () => {
      const medico = "Dra. Sentinela do Erro";
      const erro = await comRollback(async tx => {
        // Só o INSERT da autorização falha, com um erro que carrega a linha.
        const falso = new Proxy(tx, {
          get(alvo, chave, receptor) {
            if (chave !== "$queryRaw") return Reflect.get(alvo, chave, receptor);
            return (partes: TemplateStringsArray, ...valores: unknown[]) => {
              if (partes.join("").includes('INSERT INTO "autorizacao_sulamerica"')) {
                return Promise.reject(Object.assign(new Error(`Failing row contains (${medico})`), {
                  code: "P2010", meta: { detail: `Failing row contains (${medico})` },
                }));
              }
              return alvo.$queryRaw(partes, ...valores);
            };
          },
        });
        return registrarAutorizacaoNaTransacao(falso, entrada(nome(), { nomeMedico: medico }))
          .then(() => null, (e: unknown) => e);
      });
      expect(erro).toBeInstanceOf(Error);
      expect((erro as Error).message).toMatch(/P2010/);
      expect(JSON.stringify(erro) + String(erro) + String((erro as Error).cause)).not.toContain("Sentinela");
    });

    it("legado sem carteirinha, CRM nem médico continua listando com os três nulos", async () => {
      await comRollback(async tx => {
        const p = await tx.paciente.create({ data: { nome: nome() } });
        const [a] = await tx.$queryRaw<{ id: number }[]>`
          INSERT INTO autorizacao_sulamerica (paciente_id, data_inicio, prazo_meses)
          VALUES (${p.id}, '2026-01-01'::date, 6) RETURNING id`;
        const linha = (await listarAutorizacoesComCliente(tx)).find(l => l.id === a.id);
        expect(linha).toMatchObject({
          pacienteNome: p.nome, prazoMeses: 6, dataVencimento: "2026-07-01",
          numeroCarteirinha: null, crmMedico: null, nomeMedico: null,
        });
      });
    });
  });

  describe("recusa desfaz o paciente recém-criado (transação de produção)", () => {
    // `registrarAutorizacao` abre e commita a própria transação: aqui não há
    // rollback de teste por fora. Numa recusa nada pode sobrar; o `finally`
    // recolhe o que sobrar se o código estiver errado, e o dono commitado.
    async function existe(pacienteNome: string) {
      return (await getPrismaClient().paciente.count({ where: { nome: pacienteNome } })) > 0;
    }
    async function apagar(...nomes: string[]) {
      const cliente = getPrismaClient();
      await cliente.$executeRaw`DELETE FROM autorizacao_sulamerica WHERE paciente_id IN
        (SELECT id FROM paciente WHERE nome = ANY(${nomes}))`;
      await cliente.$executeRaw`DELETE FROM paciente WHERE nome = ANY(${nomes})`;
    }

    it("carteirinha obrigatória em branco: o paciente criado pelo get-or-create some", async () => {
      const pacienteNome = nome();
      try {
        expect(await registrarAutorizacao(entrada(pacienteNome, { numeroCarteirinha: " " })))
          .toEqual({ ok: false, erro: ERRO_CARTEIRINHA_OBRIGATORIA });
        expect(await existe(pacienteNome)).toBe(false);
      } finally { await apagar(pacienteNome); }
    });

    it("carteirinha de outro paciente: o paciente novo some, o dono fica intacto", async () => {
      const donoNome = nome();
      const novo = nome();
      const numero = carteirinha();
      try {
        await getPrismaClient().$executeRaw`INSERT INTO paciente (nome, numero_carteirinha, crm_medico)
          VALUES (${donoNome}, ${numero}, '1')`;
        expect(await registrarAutorizacao(entrada(novo, { numeroCarteirinha: numero })))
          .toEqual({ ok: false, erro: erroCarteirinhaDeOutroPaciente(donoNome) });
        expect(await existe(novo)).toBe(false);
        expect(await existe(donoNome)).toBe(true);
      } finally { await apagar(donoNome, novo); }
    });

    it("nome do médico inválido: nada é criado", async () => {
      const pacienteNome = nome();
      try {
        expect(await registrarAutorizacao(entrada(pacienteNome, { nomeMedico: "12" })))
          .toEqual({ ok: false, erro: ERRO_NOME_MEDICO_INVALIDO });
        expect(await existe(pacienteNome)).toBe(false);
      } finally { await apagar(pacienteNome); }
    });
  });

  it("FK RESTRICT impede apagar paciente ainda vinculado", async () => {
    await expect(comRollback(async tx => {
      const a = await registrar(tx, nome());
      await tx.$executeRaw`DELETE FROM paciente WHERE id = (SELECT paciente_id FROM autorizacao_sulamerica WHERE id = ${a.id})`;
    })).rejects.toThrow(/23503|foreign key|paciente_id_fkey/i);
  });

  it("view compara meses e ordena por urgência, depois nome sem caixa", async () => {
    await comRollback(async tx => {
      // Inícios nos dias 1 e 28 são reversíveis em qualquer mês. O segundo
      // caso do mês atual garante que classificar por dia não passaria.
      const datas = await tx.$queryRaw<{ inicio: string; status: string | null; ordem: number }[]>`
        SELECT (date_trunc('month', CURRENT_DATE) + (mes - 3) * INTERVAL '1 month'
          + dia * INTERVAL '1 day')::date::text AS inicio, status, ordem
        FROM (VALUES (-1, 0, 'Vencido', 1), (0, 0, 'Vence este mês', 2),
          (0, 27, 'Vence este mês', 3), (1, 0, 'A vencer', 4), (2, 0, NULL, 5)) AS casos(mes, dia, status, ordem)
        ORDER BY ordem DESC
      `;
      const ids: number[] = [];
      for (const d of datas) {
        const a = await registrar(tx, `${d.ordem === 2 ? "ana" : d.ordem === 3 ? "Bruno" : "Zoe"} ${nome()}`, d.inicio);
        ids.push(a.id);
        const [status] = await tx.$queryRaw<{ status: string | null }[]>`
          SELECT status_autorizacao AS status FROM autorizacao_sulamerica_status WHERE id = ${a.id}
        `;
        expect(status.status).toBe(d.status);
      }
      const lista = (await listarAutorizacoesComCliente(tx)).filter(a => ids.includes(a.id));
      expect(lista.map(a => a.statusAutorizacao)).toEqual(["Vencido", "Vence este mês", "Vence este mês", "A vencer", null]);
      expect(lista[1].pacienteNome).toMatch(/^ana /);
      expect(lista[2].pacienteNome).toMatch(/^Bruno /);
    });
  });
});

import { afterAll, describe, expect, it } from "vitest";
import { getPrismaClient } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  excluirAutorizacaoComCliente, listarAutorizacoesComCliente, registrarAutorizacaoNaTransacao,
} from "./autorizacoes-sulamerica";
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
async function registrar(tx: Prisma.TransactionClient, pacienteNome: string, dataInicio = "2026-01-31", prazoMeses = 3) {
  const resultado = await registrarAutorizacaoNaTransacao(tx, { pacienteNome, dataInicio, prazoMeses });
  if (!resultado.ok) throw new Error(resultado.erro);
  return resultado;
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
    const requisicao = await tx.requisicao.create({ data: { pacienteId, numeroRequisicao: "sul-teste" } });
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

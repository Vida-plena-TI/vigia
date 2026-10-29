/**
 * Preparo dos testes de integração: um paciente cadastrado pela **porta de
 * entrada de verdade** (`cadastrarPacienteNaTransacao`, a aba Cadastro), com
 * convênio e uma terapia no plano.
 *
 * Desde 29/10/2026 (regra 24) os encaminhamentos não criam paciente; todo
 * teste que precisa de um paciente o cadastra primeiro, como a tela faria.
 *
 * Mora fora de `app/`, `lib/`, `components/` e `scripts/` de propósito: é
 * código só de teste, e `pacientes-origem.test.ts` varre aquelas pastas
 * atrás de quem chama o cadastro — este preparo não é um caminho de produção.
 */
import type { Prisma } from "@/lib/generated/prisma/client";
import type { Convenio } from "@/lib/domain/convenio";
import { cadastrarPacienteNaTransacao } from "@/lib/domain/plano-terapias";

/**
 * A terapia do plano do preparo: a primeira do catálogo. Reaproveitar (em vez
 * de criar) é o que deixa os preparos **commitados** de alguns testes não
 * sobrarem no banco: a limpeza deles apaga o paciente, e o plano vai junto
 * pelo cascade. Só cria uma terapia se o catálogo estiver vazio.
 */
async function terapiaDoPreparo(tx: Prisma.TransactionClient): Promise<number> {
  const [existente] = await tx.$queryRaw<{ id: number }[]>`
    SELECT "id" FROM "terapia" ORDER BY "id" LIMIT 1
  `;

  if (existente) {
    return existente.id;
  }

  const rotulo = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const terapia = await tx.terapia.create({
    data: { nome: `Terapia de preparo ${rotulo}`, codigoTiss: "PREP" },
    select: { id: true },
  });

  return terapia.id;
}

/** Cadastra o paciente no convênio (padrão: Klini) e devolve id e nome gravados. */
export async function cadastrarPacienteDeTeste(
  tx: Prisma.TransactionClient,
  nome: string,
  convenio: Convenio = "klini",
): Promise<{ id: number; nome: string }> {
  const resultado = await cadastrarPacienteNaTransacao(tx, {
    nome,
    convenio,
    terapias: [{ terapiaId: await terapiaDoPreparo(tx), horas: "1" }],
  });

  if (!resultado.ok) {
    throw new Error(`preparo do paciente falhou: ${resultado.erro}`);
  }

  return { id: resultado.pacienteId, nome: resultado.pacienteNome };
}

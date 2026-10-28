/**
 * Carteirinha e CRM no paciente, dentro da transação de um cadastro de
 * encaminhamento — Klini (`encaminhamentos.ts`) ou SulAmérica
 * (`autorizacoes-sulamerica.ts`). Os dois chamam
 * {@link gravarCarteirinhaECrmNaTransacao} logo depois do get-or-create do
 * paciente e antes de travar a própria linha (encaminhamento ou autorização):
 * a ordem de lock é sempre paciente → filho.
 *
 * Movido de `encaminhamentos.ts` em 28/10/2026, quando a SulAmérica ganhou o
 * próprio cadastro de encaminhamento. As regras (regra 20) não mudaram.
 *
 * Diferente de `carteirinha-crm.ts`, este módulo fala com o banco: o
 * formulário (Client Component) não o importa.
 */
import type { Prisma } from "@/lib/generated/prisma/client";

import {
  ERRO_CARTEIRINHA_JA_CADASTRADA,
  decidirCarteirinha,
  erroCarteirinhaDeOutroPaciente,
  normalizarCrm,
  type SituacaoDaCarteirinha,
} from "./carteirinha-crm";

/**
 * Erro de negócio lançado de dentro da transação.
 *
 * Mesmo papel do de `requisicoes.ts`: precisa ser lançado, e não devolvido,
 * porque é o `throw` que desfaz o paciente que o get-or-create acabou de
 * criar. Quem chama converte de volta para `{ ok: false }`. Compartilhado
 * pelos dois cadastros de encaminhamento (Klini e SulAmérica).
 */
export class ErroDeNegocio extends Error {
  constructor(readonly erro: string) {
    super(erro);
    this.name = "ErroDeNegocio";
  }
}

/** Nome do índice `UNIQUE (lower(numero_carteirinha)) WHERE ... IS NOT NULL`. */
const UNIQUE_CARTEIRINHA = "paciente_numero_carteirinha_lower_key";

/**
 * `true` se `erro` é o choque com o índice único da carteirinha.
 *
 * Com o `@prisma/adapter-pg` o nome do índice vem em
 * `meta.driverAdapterError.cause.constraint.index` (o `target` nem existe) —
 * mesma leitura de `violouUnique` em `requisicoes.ts`.
 */
function violouUniqueDaCarteirinha(erro: unknown): boolean {
  if (typeof erro !== "object" || erro === null) {
    return false;
  }

  const candidato = erro as { code?: unknown; meta?: unknown };

  return (
    candidato.code === "P2002" &&
    JSON.stringify(candidato.meta ?? "").includes(UNIQUE_CARTEIRINHA)
  );
}

/**
 * O nome do paciente que já tem esta carteirinha, se não for `pacienteId`.
 *
 * A comparação é `lower(numero_carteirinha) = lower($1)`, a mesma expressão do
 * índice único — como `lower(nome)` no get-or-create, para a checagem e a
 * constraint nunca discordarem.
 */
async function donoDaCarteirinha(
  tx: Prisma.TransactionClient,
  numeroCarteirinha: string,
  pacienteId: number,
): Promise<string | null> {
  const [dono] = await tx.$queryRaw<{ nome: string }[]>`
    SELECT "nome"
    FROM "paciente"
    WHERE "numero_carteirinha" IS NOT NULL
      AND lower("numero_carteirinha") = lower(${numeroCarteirinha})
      AND "id" <> ${pacienteId}
    LIMIT 1
  `;

  return dono?.nome ?? null;
}

/**
 * Grava carteirinha e CRM no paciente, recusando carteirinha de outra pessoa.
 *
 * `numeroCarteirinha: null` é "manter a gravada": o UPDATE só leva o CRM, e
 * nem a checagem de dono nem o índice entram em jogo.
 *
 * Duas camadas, cada uma com um papel:
 *
 * 1. **A checagem prévia é a mensagem boa.** Ela acha o dono e devolve "Esta
 *    carteirinha já está cadastrada para X." — o caminho de quase todo
 *    conflito.
 * 2. **O índice único é a garantia.** Dois cadastros simultâneos de pacientes
 *    diferentes com a mesma carteirinha passam os dois pela checagem (nenhum
 *    enxerga o outro, ainda não commitado); o segundo UPDATE espera no índice
 *    e, quando o primeiro commita, recebe `23505`. Para essa corrida também
 *    sair com o nome do dono, o UPDATE roda dentro de um `SAVEPOINT`: um erro
 *    de comando aborta a transação inteira no Postgres, e sem o savepoint não
 *    haveria como fazer a consulta do nome. `ROLLBACK TO SAVEPOINT` devolve a
 *    transação a um estado utilizável, a consulta enxerga o commit do outro
 *    (READ COMMITTED, comando novo) e o `throw` desfaz o resto.
 *
 * **Qualquer outro erro do UPDATE é saneado antes de escapar.** Uma violação
 * de CHECK traz no `meta` do Prisma o `detail` do Postgres — "Failing row
 * contains (...)", a linha inteira, carteirinha e CRM inclusive — e uma
 * exceção não tratada é logada pelo Next com tudo isso. O erro relançado leva
 * só o id do paciente e o código do Prisma, **sem** `cause`. Na prática ele é
 * inalcançável (o domínio valida antes), mas é a única rota pela qual esses
 * dados chegariam a um log.
 *
 * Roda **antes** de travar o encaminhamento, e isso é ordem de lock: a linha
 * do paciente é travada primeiro (pela leitura de `situacaoDaCarteirinha`,
 * com o mesmo lock que este UPDATE pediria), e a exclusão de paciente também vai `paciente` →
 * `encaminhamento`/`autorizacao_sulamerica` (`excluirPacienteNaTransacao`). Na ordem inversa, as duas
 * poderiam se travar em cruz. O lock do UPDATE é `FOR NO KEY UPDATE` — o
 * índice é de expressão e parcial, então não conta como chave para FK — e por
 * isso não conflita com o `FOR KEY SHARE` que um INSERT de requisição ou
 * encaminhamento pede no paciente. Efeito colateral bom: dois cadastros
 * simultâneos do mesmo paciente passam a se serializar já aqui.
 */
async function gravarCarteirinhaECrm(
  tx: Prisma.TransactionClient,
  pacienteId: number,
  numeroCarteirinha: string | null,
  crmMedico: string,
): Promise<void> {
  if (numeroCarteirinha !== null) {
    const dono = await donoDaCarteirinha(tx, numeroCarteirinha, pacienteId);

    if (dono !== null) {
      throw new ErroDeNegocio(erroCarteirinhaDeOutroPaciente(dono));
    }
  }

  await tx.$executeRaw`SAVEPOINT "carteirinha_do_paciente"`;

  try {
    await tx.paciente.update({
      where: { id: pacienteId },
      data:
        numeroCarteirinha === null
          ? { crmMedico }
          : { numeroCarteirinha, crmMedico },
    });
  } catch (erro) {
    if (numeroCarteirinha === null || !violouUniqueDaCarteirinha(erro)) {
      const codigo = (erro as { code?: unknown } | null)?.code;

      throw new Error(
        `falha ao gravar carteirinha/CRM do paciente ${pacienteId} (${String(codigo ?? "sem codigo")})`,
      );
    }

    await tx.$executeRaw`ROLLBACK TO SAVEPOINT "carteirinha_do_paciente"`;

    const donoDaCorrida = await donoDaCarteirinha(
      tx,
      numeroCarteirinha,
      pacienteId,
    );

    throw new ErroDeNegocio(
      donoDaCorrida === null
        ? ERRO_CARTEIRINHA_JA_CADASTRADA
        : erroCarteirinhaDeOutroPaciente(donoDaCorrida),
    );
  }

  await tx.$executeRaw`RELEASE SAVEPOINT "carteirinha_do_paciente"`;
}

/**
 * Se o paciente tem carteirinha, lido sob o lock da linha dele.
 *
 * O `FOR NO KEY UPDATE` é o mesmo lock que o UPDATE de `gravarCarteirinhaECrm`
 * já tomava — só que agora tomado antes, na leitura que decide se a
 * carteirinha é obrigatória. Por isso a ordem de lock não muda (paciente →
 * encaminhamento) e a decisão não tem corrida: um cadastro simultâneo do mesmo
 * paciente espera aqui, e quando passa já enxerga a carteirinha que o outro
 * gravou (READ COMMITTED relê a linha travada).
 *
 * Devolve só o booleano: o número não sai do banco à toa.
 */
async function situacaoDaCarteirinha(
  tx: Prisma.TransactionClient,
  paciente: { id: number; criado: boolean },
): Promise<SituacaoDaCarteirinha> {
  const [linha] = await tx.$queryRaw<{ temCarteirinha: boolean }[]>`
    SELECT "numero_carteirinha" IS NOT NULL AS "temCarteirinha"
    FROM "paciente"
    WHERE "id" = ${paciente.id}
    FOR NO KEY UPDATE
  `;

  if (paciente.criado) {
    return "paciente-novo";
  }

  return linha?.temCarteirinha ? "com-carteirinha" : "sem-carteirinha";
}

/**
 * Decide e grava carteirinha e CRM do paciente, sob o lock da linha dele.
 *
 * Situação da carteirinha (`FOR NO KEY UPDATE`) → `decidirCarteirinha` →
 * {@link gravarCarteirinhaECrm}. A obrigatoriedade da carteirinha é decidida
 * aqui, e não na validação sem banco, porque depende do que o paciente já
 * tem. Recusa é `throw` de {@link ErroDeNegocio}, que desfaz o paciente
 * recém-criado junto com a transação.
 *
 * `numeroCarteirinha` e `crmMedico` chegam como foram digitados; o CRM já foi
 * validado pelo chamador (`validarCrm`), aqui só é normalizado.
 */
export async function gravarCarteirinhaECrmNaTransacao(
  tx: Prisma.TransactionClient,
  paciente: { id: number; criado: boolean },
  numeroCarteirinha: string,
  crmMedico: string,
): Promise<void> {
  const carteirinha = decidirCarteirinha(
    numeroCarteirinha,
    await situacaoDaCarteirinha(tx, paciente),
  );

  if (!carteirinha.ok) {
    throw new ErroDeNegocio(carteirinha.erro);
  }

  await gravarCarteirinhaECrm(
    tx,
    paciente.id,
    carteirinha.gravar,
    normalizarCrm(crmMedico),
  );
}

/**
 * Cadastro de paciente com convênio e plano de terapias por semana
 * (29/10/2026).
 *
 * {@link cadastrarPaciente} é a porta de entrada do paciente que está sendo
 * construída: nome + convênio + ao menos uma terapia com as horas por semana.
 * **Em andamento até o P2**: por enquanto os dois cadastros de encaminhamento
 * (Klini e SulAmérica) continuam criando paciente também — sem convênio
 * (`convenio` NULL) —, e este cadastro adota o convênio quando encontra um
 * paciente assim.
 *
 * O plano é **só informativo**: minutos por semana de cada terapia, sem campo
 * calculado nem soma. Nada no sistema lê o plano para decidir saldo, guia ou
 * atendimento.
 *
 * Os quatro desfechos, todos na mesma transação (um `throw` desfaz tudo,
 * inclusive o paciente recém-criado):
 *
 *   - paciente não existe → nasce com o convênio e o plano;
 *   - existe com o mesmo convênio → o plano é **substituído inteiro** (DELETE
 *     das linhas dele + INSERT das novas); o nome gravado não muda;
 *   - existe com convênio NULL → adota o convênio e grava o plano;
 *   - existe com o outro convênio → recusa, sem gravar nada.
 *
 * **Ordem de lock**: get-or-create do paciente (`obterOuCriarPaciente`, o mesmo
 * dos encaminhamentos) → `SELECT ... FOR NO KEY UPDATE` no paciente (o mesmo
 * lock da carteirinha nos encaminhamentos: serializa dois cadastros do mesmo
 * paciente e não bloqueia o `FOR KEY SHARE` de uma requisição) → terapias
 * `FOR KEY SHARE` → `plano_terapia` (DELETE + INSERT). É a direção paciente →
 * filhos de todo o resto do sistema, inclusive da exclusão permanente
 * (paciente `FOR UPDATE` → filhos), que leva o plano pelo `ON DELETE CASCADE`.
 *
 * Privacidade: nada aqui loga nome nem plano, e nenhuma mensagem repete o que
 * foi digitado.
 */
import { getPrismaClient } from "@/lib/db";
import { OPCOES_DE_TRANSACAO } from "@/lib/db/transacao";
import type { Prisma } from "@/lib/generated/prisma/client";

import { ehConvenioValido, type Convenio } from "./convenio";
import { obterOuCriarPaciente } from "./pacientes";
import {
  ERRO_CONVENIO_INVALIDO,
  ERRO_OUTRO_CONVENIO,
  ERRO_PACIENTE_EXCLUIDO_AGORA,
  ERRO_PACIENTE_OBRIGATORIO,
  ERRO_SEM_TERAPIA,
  ERRO_TERAPIA_INEXISTENTE,
  ERRO_TERAPIA_OBRIGATORIA,
  ERRO_TERAPIA_REPETIDA,
} from "./plano-terapias-mensagens";
import { lerHorasSemanais } from "./tempo-semanal";

/**
 * Reexportadas para quem consome o domínio não precisar saber que mensagens,
 * convênio e tempo semanal moram em módulos à parte (moram lá para o
 * formulário poder importá-los sem arrastar o Prisma para o cliente).
 */
export * from "./plano-terapias-mensagens";
export * from "./convenio";
export * from "./tempo-semanal";

/** O catálogo de terapias para o formulário — o mesmo de "Nova requisição". */
export { listarTerapias } from "./requisicoes";

/** Uma linha do formulário: a terapia e as horas por semana como digitadas. */
export type LinhaDoPlano = { terapiaId: number; horas: string };

export type EntradaCadastroDePaciente = {
  nome: string;
  /** Validado em {@link validarEntrada}; chega como texto do formulário. */
  convenio: string;
  terapias: LinhaDoPlano[];
};

export type ResultadoCadastro =
  | {
      ok: true;
      pacienteId: number;
      /** O nome **gravado** (o de um paciente existente não muda). */
      pacienteNome: string;
      pacienteCriado: boolean;
      /** `true` quando o paciente existia com convênio NULL e passou a ter este. */
      convenioAdotado: boolean;
      /** Linhas do plano anterior apagadas pela substituição (0 se não havia). */
      linhasSubstituidas: number;
      /** Linhas gravadas no plano novo. */
      terapias: number;
    }
  | { ok: false; erro: string; linha?: number };

/** Entrada validada e convertida, pronta para a transação. */
type EntradaValida = {
  nome: string;
  convenio: Convenio;
  plano: { terapiaId: number; minutosSemanais: number }[];
};

/**
 * Erro de negócio lançado de dentro da transação — o `throw` é o que desfaz o
 * paciente recém-criado. Mesmo desenho do de `requisicoes.ts` (com a linha do
 * formulário, quando o erro é de uma).
 */
class ErroDeNegocio extends Error {
  constructor(
    readonly erro: string,
    readonly linha?: number,
  ) {
    super(erro);
    this.name = "ErroDeNegocio";
  }
}

/**
 * Validação e conversão que não precisam do banco.
 *
 * O nome é só trimado, como em todo cadastro de paciente: a comparação com o
 * existente é a do get-or-create (`lower(nome) = lower($1)`, a expressão do
 * índice único), então caixa diferente casa com o mesmo paciente.
 */
export function validarEntrada(
  entrada: EntradaCadastroDePaciente,
): { ok: true; entrada: EntradaValida } | { ok: false; erro: string; linha?: number } {
  const nome = entrada.nome.trim();

  if (!nome) {
    return { ok: false, erro: ERRO_PACIENTE_OBRIGATORIO };
  }

  if (!ehConvenioValido(entrada.convenio)) {
    return { ok: false, erro: ERRO_CONVENIO_INVALIDO };
  }

  if (entrada.terapias.length === 0) {
    return { ok: false, erro: ERRO_SEM_TERAPIA };
  }

  const plano: EntradaValida["plano"] = [];

  for (const [indice, linha] of entrada.terapias.entries()) {
    if (!Number.isInteger(linha.terapiaId) || linha.terapiaId <= 0) {
      return { ok: false, erro: ERRO_TERAPIA_OBRIGATORIA, linha: indice };
    }

    // UNIQUE (paciente_id, terapia_id): duas linhas da mesma terapia não têm
    // leitura certa de qual tempo vale. Aponta a segunda.
    if (plano.some((anterior) => anterior.terapiaId === linha.terapiaId)) {
      return { ok: false, erro: ERRO_TERAPIA_REPETIDA, linha: indice };
    }

    const tempo = lerHorasSemanais(linha.horas);

    if (!tempo.ok) {
      return { ok: false, erro: tempo.erro, linha: indice };
    }

    plano.push({ terapiaId: linha.terapiaId, minutosSemanais: tempo.minutos });
  }

  return { ok: true, entrada: { nome, convenio: entrada.convenio, plano } };
}

/**
 * O cadastro em si, já dentro de uma transação. Lança {@link ErroDeNegocio}
 * em vez de devolver `{ ok: false }`: devolver faria o Prisma commitar o
 * paciente recém-criado.
 */
async function cadastrarNaTransacao(
  tx: Prisma.TransactionClient,
  entrada: EntradaValida,
): Promise<Extract<ResultadoCadastro, { ok: true }>> {
  const paciente = await obterOuCriarPaciente(tx, entrada.nome);

  // O convênio decide entre os desfechos, então é lido com a linha travada:
  // dois cadastros do mesmo paciente se serializam aqui, e o segundo enxerga
  // o convênio que o primeiro gravou.
  const [atual] = await tx.$queryRaw<{ convenio: string | null }[]>`
    SELECT "convenio" FROM "paciente" WHERE "id" = ${paciente.id} FOR NO KEY UPDATE
  `;

  // O get-or-create achou o paciente sem travá-lo; uma exclusão permanente que
  // commitou entre ele e a trava acima o apagou.
  if (!atual) {
    throw new ErroDeNegocio(ERRO_PACIENTE_EXCLUIDO_AGORA);
  }

  if (atual.convenio !== null && atual.convenio !== entrada.convenio) {
    throw new ErroDeNegocio(ERRO_OUTRO_CONVENIO);
  }

  if (atual.convenio === null) {
    await tx.$executeRaw`
      UPDATE "paciente" SET "convenio" = ${entrada.convenio} WHERE "id" = ${paciente.id}
    `;
  }

  // Terapias existem? Conferido antes de escrever no plano, para a recusa ser
  // uma frase e apontar a linha, e não um erro de FK. `FOR KEY SHARE` é o lock
  // que o INSERT pediria de qualquer jeito, adiantado.
  const ids = entrada.plano.map((linha) => linha.terapiaId);
  const existentes = await tx.$queryRaw<{ id: number }[]>`
    SELECT "id" FROM "terapia" WHERE "id" = ANY(${ids}::int[]) FOR KEY SHARE
  `;
  const idsExistentes = new Set(existentes.map((terapia) => terapia.id));
  const indiceRuim = ids.findIndex((id) => !idsExistentes.has(id));

  if (indiceRuim !== -1) {
    throw new ErroDeNegocio(ERRO_TERAPIA_INEXISTENTE, indiceRuim);
  }

  // Substitui o plano inteiro: o que não veio no envio sai.
  const linhasSubstituidas = await tx.$executeRaw`
    DELETE FROM "plano_terapia" WHERE "paciente_id" = ${paciente.id}
  `;

  const { count } = await tx.planoTerapia.createMany({
    data: entrada.plano.map((linha) => ({
      pacienteId: paciente.id,
      terapiaId: linha.terapiaId,
      minutosSemanais: linha.minutosSemanais,
    })),
  });

  return {
    ok: true,
    pacienteId: paciente.id,
    pacienteNome: paciente.nome,
    pacienteCriado: paciente.criado,
    convenioAdotado: atual.convenio === null && !paciente.criado,
    linhasSubstituidas,
    terapias: count,
  };
}

/**
 * Cadastra o paciente (ou atualiza o plano de quem já existe), abrindo a
 * própria transação. É esta que a Server Action chama, e é ela que garante a
 * atomicidade.
 */
export async function cadastrarPaciente(
  entrada: EntradaCadastroDePaciente,
): Promise<ResultadoCadastro> {
  const validacao = validarEntrada(entrada);

  if (!validacao.ok) {
    return validacao;
  }

  try {
    return await getPrismaClient().$transaction(
      (tx) => cadastrarNaTransacao(tx, validacao.entrada),
      OPCOES_DE_TRANSACAO,
    );
  } catch (erro) {
    if (erro instanceof ErroDeNegocio) {
      return { ok: false, erro: erro.erro, linha: erro.linha };
    }

    throw erro;
  }
}

/**
 * {@link cadastrarPaciente} numa transação já aberta, para o teste de
 * integração. O erro de negócio vira `{ ok: false }` **sem desfazer nada** —
 * quem controla o rollback é o chamador. Erro inesperado continua lançado.
 */
export async function cadastrarPacienteNaTransacao(
  tx: Prisma.TransactionClient,
  entrada: EntradaCadastroDePaciente,
): Promise<ResultadoCadastro> {
  const validacao = validarEntrada(entrada);

  if (!validacao.ok) {
    return validacao;
  }

  try {
    return await cadastrarNaTransacao(tx, validacao.entrada);
  } catch (erro) {
    if (erro instanceof ErroDeNegocio) {
      return { ok: false, erro: erro.erro, linha: erro.linha };
    }

    throw erro;
  }
}

// ---------------------------------------------------------------------------
// Leituras (nenhuma escreve)
// ---------------------------------------------------------------------------

/** Uma terapia do plano, com o tempo gravado. */
export type TerapiaDoPlano = {
  terapiaId: number;
  terapiaNome: string;
  minutosSemanais: number;
};

/** Um paciente na lista do convênio. */
export type PacienteDoConvenio = {
  pacienteId: number;
  pacienteNome: string;
  /** As terapias do plano em ordem de nome; vazio se não tem plano. */
  plano: TerapiaDoPlano[];
  temPlano: boolean;
};

/** {@link listarPacientesDoConvenio} num cliente dado — o teste passa a transação. */
export async function listarPacientesDoConvenioComCliente(
  cliente: Pick<Prisma.TransactionClient, "$queryRaw">,
  convenio: Convenio,
): Promise<PacienteDoConvenio[]> {
  if (!ehConvenioValido(convenio)) {
    throw new Error("convenio invalido na listagem de pacientes");
  }

  // `json_agg` em subconsulta por paciente: uma linha por paciente, com o
  // plano já em ordem. O `COALESCE` devolve `[]` para quem não tem plano.
  return cliente.$queryRaw<PacienteDoConvenio[]>`
    SELECT
      p."id"   AS "pacienteId",
      p."nome" AS "pacienteNome",
      COALESCE(
        (
          SELECT json_agg(
                   json_build_object(
                     'terapiaId', t."id",
                     'terapiaNome', t."nome",
                     'minutosSemanais', pt."minutos_semanais"
                   )
                   ORDER BY lower(t."nome"), t."id"
                 )
          FROM "plano_terapia" pt
          JOIN "terapia" t ON t."id" = pt."terapia_id"
          WHERE pt."paciente_id" = p."id"
        ),
        '[]'::json
      ) AS "plano",
      EXISTS (
        SELECT 1 FROM "plano_terapia" pt WHERE pt."paciente_id" = p."id"
      ) AS "temPlano"
    FROM "paciente" p
    WHERE p."convenio" = ${convenio}
    ORDER BY lower(p."nome"), p."id"
  `;
}

/** Pacientes de um convênio, em ordem de nome, com o plano de cada um. */
export async function listarPacientesDoConvenio(
  convenio: Convenio,
): Promise<PacienteDoConvenio[]> {
  return listarPacientesDoConvenioComCliente(getPrismaClient(), convenio);
}

/** {@link planoDoPaciente} num cliente dado — o teste passa a transação. */
export async function planoDoPacienteComCliente(
  cliente: Pick<Prisma.TransactionClient, "$queryRaw">,
  pacienteId: number,
): Promise<TerapiaDoPlano[]> {
  if (!Number.isInteger(pacienteId) || pacienteId <= 0) {
    return [];
  }

  return cliente.$queryRaw<TerapiaDoPlano[]>`
    SELECT
      t."id"                AS "terapiaId",
      t."nome"              AS "terapiaNome",
      pt."minutos_semanais" AS "minutosSemanais"
    FROM "plano_terapia" pt
    JOIN "terapia" t ON t."id" = pt."terapia_id"
    WHERE pt."paciente_id" = ${pacienteId}
    ORDER BY lower(t."nome"), t."id"
  `;
}

/** As terapias do plano de um paciente, com os minutos por semana. */
export async function planoDoPaciente(
  pacienteId: number,
): Promise<TerapiaDoPlano[]> {
  return planoDoPacienteComCliente(getPrismaClient(), pacienteId);
}

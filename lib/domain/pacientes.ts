/**
 * Paciente: o get-or-create por nome, a lista de nomes para autocomplete e a
 * **exclusão permanente e completa** do cadastro.
 *
 * Este módulo nasceu de `lib/domain/requisicoes.ts`, onde as duas funções
 * moravam quando só o cadastro de requisição precisava delas. Com o cadastro
 * de encaminhamento aparecendo um segundo consumidor, elas subiram para cá em
 * vez de serem copiadas: duas cópias do get-or-create acabariam divergindo, e
 * é justamente a expressão de comparação que precisa ser a mesma em todo lugar
 * (ver abaixo). Nenhum comportamento mudou na mudança de arquivo.
 *
 * A comparação de nome é `lower(nome) = lower($1)`, a mesma expressão do índice
 * `UNIQUE (lower(nome))` criado em
 * `20260828120100_indices_e_constraints_manuais`. Usar a mesma expressão dos
 * dois lados é o que faz a busca e a constraint concordarem: se a busca usasse
 * outra regra (`ILIKE`, `unaccent`, comparação em JavaScript), ela poderia não
 * achar um paciente que o índice mesmo assim recusaria como duplicado, e o
 * insert estouraria em vez de reaproveitar a linha existente.
 */
import { getPrismaClient } from "@/lib/db";
import { OPCOES_DE_TRANSACAO } from "@/lib/db/transacao";
import type { Prisma } from "@/lib/generated/prisma/client";

import {
  ERRO_ID_INVALIDO,
  ERRO_PACIENTE_INEXISTENTE,
} from "./pacientes-mensagens";

/**
 * Reexportadas para quem consome o domínio não precisar saber que as mensagens
 * moram em um módulo à parte (elas moram lá só para o diálogo de confirmação
 * poder importá-las sem arrastar o Prisma para o cliente).
 */
export * from "./pacientes-mensagens";

/** Um paciente resolvido pelo get-or-create. */
export type PacienteResolvido = { id: number; nome: string; criado: boolean };

/**
 * Get-or-create do paciente, case-insensitive, em uma única ida ao banco.
 *
 * O `INSERT ... ON CONFLICT (lower("nome")) DO NOTHING` dentro de uma CTE
 * resolve a corrida que um `SELECT` seguido de `INSERT` deixaria aberta: dois
 * cadastros simultâneos do mesmo nome não viram duas linhas nem estouram a
 * unique — o segundo cai no `UNION ALL` e reaproveita a linha do primeiro.
 *
 * O `RETURNING` do insert vem primeiro no `UNION ALL`, então quando ele produz
 * linha é ela que o `LIMIT 1` devolve.
 *
 * O laço existe por causa de uma janela estreita do READ COMMITTED: se um
 * insert concorrente ainda não tinha commitado quando o snapshot do `SELECT`
 * foi tirado, o `DO NOTHING` não insere e o `SELECT` não enxerga — as duas
 * metades voltam vazias. Na tentativa seguinte o snapshot é novo e a linha
 * aparece.
 *
 * Recebe o cliente da transação porque quem chama sempre precisa que o
 * paciente e o registro que o referencia nasçam juntos ou não nasçam: um
 * `throw` depois desta chamada tem de desfazer o paciente recém-criado.
 *
 * O nome deve chegar **já trimado** — é responsabilidade de quem chama, do
 * mesmo jeito que era quando esta função morava em `requisicoes.ts`.
 */
export async function obterOuCriarPaciente(
  tx: Prisma.TransactionClient,
  nome: string,
): Promise<PacienteResolvido> {
  for (let tentativa = 0; tentativa < 3; tentativa += 1) {
    const linhas = await tx.$queryRaw<PacienteResolvido[]>`
      WITH "inserido" AS (
        INSERT INTO "paciente" ("nome")
        VALUES (${nome})
        ON CONFLICT (lower("nome")) DO NOTHING
        RETURNING "id", "nome"
      )
      SELECT "id", "nome", true AS "criado" FROM "inserido"
      UNION ALL
      SELECT "id", "nome", false AS "criado"
      FROM "paciente"
      WHERE lower("nome") = lower(${nome})
      LIMIT 1
    `;

    if (linhas.length > 0) {
      return linhas[0];
    }
  }

  throw new Error(
    `nao foi possivel resolver o paciente ${JSON.stringify(nome)} apos 3 tentativas`,
  );
}

/**
 * Nomes de pacientes para o `datalist` dos formulários.
 *
 * Só o nome: o `datalist` sugere texto, e o paciente é resolvido no servidor
 * pelo nome mesmo (get-or-create), não por id. Mandar o id junto daria a falsa
 * impressão de que escolher da lista é diferente de digitar o nome inteiro.
 */
export async function listarNomesDePacientes(): Promise<string[]> {
  const pacientes = await getPrismaClient().$queryRaw<{ nome: string }[]>`
    SELECT "nome" FROM "paciente" ORDER BY lower("nome"), "id"
  `;

  return pacientes.map((paciente) => paciente.nome);
}

/**
 * ---------------------------------------------------------------------------
 * Exclusão permanente e completa de um paciente
 * ---------------------------------------------------------------------------
 *
 * **Isto apaga dados de prontuário de forma irreversível.** Não é soft-delete,
 * não é arquivamento, não há lixeira: os `DELETE` abaixo são definitivos e a
 * aplicação não oferece nenhuma forma de desfazer. A decisão foi tomada pelo
 * usuário do sistema com a exigência de guarda de prontuário médico já sobre a
 * mesa (CFM: 20+ anos, ou guarda permanente em meio digital) — está registrada
 * em CONTEXT.md, em "Exclusão permanente de paciente", e é lá que ela deve ser
 * revisitada, não aqui.
 *
 * A porta de entrada é a aba Encaminhamentos, e a razão de a exclusão ser do
 * **paciente inteiro** — e não só do encaminhamento clicado — é a regra 15:
 * paciente sem encaminhamento não pode ter requisição. Apagar só o
 * encaminhamento deixaria as requisições existentes num estado que o próprio
 * sistema recusa criar.
 *
 * A ordem dos `DELETE` é ditada pelas FKs `RESTRICT` do schema, e o único
 * `CASCADE` do sistema (atendimento -> requisicao_terapia) é usado, não
 * duplicado — ver {@link excluirPacienteNaTransacao}.
 */

/** O tamanho do estrago, lido do banco antes de qualquer confirmação. */
export type ContagemParaExclusao = {
  pacienteId: number;
  pacienteNome: string;
  requisicoes: number;
  /** Linhas de `requisicao_terapia` ("guias") de todas as requisições dele. */
  guias: number;
  atendimentos: number;
  temEncaminhamento: boolean;
  temAutorizacaoSulamerica: boolean;
};

export type ResultadoDaContagem =
  | { ok: true; contagem: ContagemParaExclusao }
  | { ok: false; erro: string };

export type ResultadoDaExclusao =
  | {
      ok: true;
      pacienteNome: string;
      /** O que a transação de fato apagou, não o que o diálogo previu. */
      requisicoes: number;
      guias: number;
      atendimentos: number;
    }
  | { ok: false; erro: string };

/**
 * As quatro contagens numa consulta só, com o cliente recebido de fora.
 *
 * Mesma forma de `listarEncaminhamentosComCliente`: quem chama decide se
 * entrega o cliente global (o diálogo, antes de abrir) ou o da transação de
 * exclusão (para relatar o que foi apagado), e o SQL — que é o que precisa
 * concordar entre os dois usos — é um só. Se a contagem do diálogo e a do
 * resultado divergissem, o usuário confirmaria um número e veria outro.
 *
 * `count(*)::int` porque o Postgres devolve `bigint` em `count`, e `bigint`
 * chega no Node como `BigInt` — que a serialização da fronteira de Server
 * Action não sabe atravessar.
 */
async function contarComCliente(
  cliente: Pick<Prisma.TransactionClient, "$queryRaw">,
  pacienteId: number,
): Promise<ContagemParaExclusao | null> {
  const linhas = await cliente.$queryRaw<ContagemParaExclusao[]>`
    SELECT
      p."id"   AS "pacienteId",
      p."nome" AS "pacienteNome",
      (
        SELECT count(*)::int FROM "requisicao" r
        WHERE r."paciente_id" = p."id"
      ) AS "requisicoes",
      (
        SELECT count(*)::int
        FROM "requisicao_terapia" rt
        JOIN "requisicao" r ON r."id" = rt."requisicao_id"
        WHERE r."paciente_id" = p."id"
      ) AS "guias",
      (
        SELECT count(*)::int
        FROM "atendimento" a
        JOIN "requisicao_terapia" rt ON rt."id" = a."requisicao_terapia_id"
        JOIN "requisicao" r ON r."id" = rt."requisicao_id"
        WHERE r."paciente_id" = p."id"
      ) AS "atendimentos",
      EXISTS (
        SELECT 1 FROM "encaminhamento" e WHERE e."paciente_id" = p."id"
      ) AS "temEncaminhamento",
      EXISTS (
        SELECT 1 FROM "autorizacao_sulamerica" a WHERE a."paciente_id" = p."id"
      ) AS "temAutorizacaoSulamerica"
    FROM "paciente" p
    WHERE p."id" = ${pacienteId}
  `;

  return linhas[0] ?? null;
}

/**
 * O que será apagado se a exclusão for confirmada.
 *
 * É esta função que alimenta a frase do diálogo, e é por isso que ela existe
 * separada da exclusão: o usuário precisa ver o número **real** antes de
 * decidir, não uma estimativa nem um "todos os dados relacionados".
 *
 * As contagens são de leitura, fora de transação: entre olhar e confirmar, o
 * banco pode mudar. Quem garante que a exclusão apaga o que existe **no
 * momento do DELETE** é {@link excluirPacienteNaTransacao}, que conta de novo lá
 * dentro, com a linha do paciente travada.
 */
export async function contarParaExclusao(
  pacienteId: number,
): Promise<ResultadoDaContagem> {
  if (!Number.isInteger(pacienteId) || pacienteId <= 0) {
    return { ok: false, erro: ERRO_ID_INVALIDO };
  }

  const contagem = await contarComCliente(getPrismaClient(), pacienteId);

  if (!contagem) {
    return { ok: false, erro: ERRO_PACIENTE_INEXISTENTE };
  }

  return { ok: true, contagem };
}

/**
 * Apaga o paciente e tudo que pende dele, numa transação já aberta.
 *
 * A ordem não é preferência de estilo: as FKs `requisicao -> paciente`,
 * `requisicao_terapia -> requisicao` e `encaminhamento -> paciente` são todas
 * `ON DELETE RESTRICT`, então o banco recusa qualquer outra sequência. De baixo
 * para cima:
 *
 *   1. `requisicao_terapia` das requisições do paciente — e os `atendimento`
 *      filhos vão junto pelo `ON DELETE CASCADE`, o único cascade do sistema
 *      (regra 10). Um `DELETE FROM atendimento` explícito antes deste seria
 *      correto e inútil: apagaria as mesmas linhas um passo antes, e passaria a
 *      ser uma segunda descrição de uma regra que já mora no schema.
 *   2. `requisicao` do paciente.
 *   3. `encaminhamento` do paciente (no máximo uma linha, `UNIQUE`).
 *   4. `autorizacao_sulamerica` do paciente, se houver.
 *   5. `paciente`.
 *
 * Qualquer falha no meio — erro de banco, FK inesperada, queda de conexão —
 * lança, e a transação inteira volta atrás: **nada fica apagado pela metade**.
 * Há teste de integração que injeta um erro entre dois `DELETE` e confirma que
 * as quatro tabelas continuam intactas.
 *
 * O `FOR UPDATE` no paciente faz mais do que travar a linha contra outra
 * exclusão simultânea: o Postgres pega `FOR KEY SHARE` na linha referenciada ao
 * inserir um filho, e `FOR UPDATE` conflita com ele. Ou seja, uma criação de
 * requisição concorrente para este mesmo paciente fica esperando esta transação
 * — e depois falha na FK, porque o paciente já não existe. Sem o lock, ela
 * poderia escorregar entre a contagem e o `DELETE` e ser apagada sem nunca ter
 * sido contada.
 *
 * Recebe o cliente da transação (em vez de abrir a própria) pelo mesmo motivo
 * de `excluirGuiaNaTransacao` e `criarRequisicaoNaTransacao`: é o que deixa o
 * teste de integração montar o cenário e controlar o rollback.
 *
 * @see excluirPacientePeloId para a versão que abre a transação sozinha.
 */
export async function excluirPacienteNaTransacao(
  tx: Prisma.TransactionClient,
  pacienteId: number,
): Promise<ResultadoDaExclusao> {
  if (!Number.isInteger(pacienteId) || pacienteId <= 0) {
    return { ok: false, erro: ERRO_ID_INVALIDO };
  }

  const travados = await tx.$queryRaw<{ id: number }[]>`
    SELECT "id" FROM "paciente" WHERE "id" = ${pacienteId} FOR UPDATE
  `;

  if (travados.length === 0) {
    return { ok: false, erro: ERRO_PACIENTE_INEXISTENTE };
  }

  // Contado aqui dentro, com a linha travada: é este número que descreve o que
  // os DELETE abaixo vão levar. O do diálogo é de antes, e serviu para decidir.
  const contagem = await contarComCliente(tx, pacienteId);

  if (!contagem) {
    return { ok: false, erro: ERRO_PACIENTE_INEXISTENTE };
  }

  await tx.$executeRaw`
    DELETE FROM "requisicao_terapia"
    WHERE "requisicao_id" IN (
      SELECT "id" FROM "requisicao" WHERE "paciente_id" = ${pacienteId}
    )
  `;

  await tx.$executeRaw`
    DELETE FROM "requisicao" WHERE "paciente_id" = ${pacienteId}
  `;

  await tx.$executeRaw`
    DELETE FROM "encaminhamento" WHERE "paciente_id" = ${pacienteId}
  `;

  await tx.$executeRaw`
    DELETE FROM "autorizacao_sulamerica" WHERE "paciente_id" = ${pacienteId}
  `;

  await tx.$executeRaw`
    DELETE FROM "paciente" WHERE "id" = ${pacienteId}
  `;

  return {
    ok: true,
    pacienteNome: contagem.pacienteNome,
    requisicoes: contagem.requisicoes,
    guias: contagem.guias,
    atendimentos: contagem.atendimentos,
  };
}

/**
 * {@link excluirPacienteNaTransacao} abrindo a própria transação.
 *
 * É esta que a Server Action chama, e é ela que garante a atomicidade — a outra
 * depende de quem abriu a transação para isso.
 *
 * O id é validado aqui também, antes de abrir a transação: não vale gastar uma
 * conexão com o banco por causa de um id que o cliente inventou.
 */
export async function excluirPacientePeloId(
  pacienteId: number,
): Promise<ResultadoDaExclusao> {
  if (!Number.isInteger(pacienteId) || pacienteId <= 0) {
    return { ok: false, erro: ERRO_ID_INVALIDO };
  }

  return getPrismaClient().$transaction(
    (tx) => excluirPacienteNaTransacao(tx, pacienteId),
    OPCOES_DE_TRANSACAO,
  );
}

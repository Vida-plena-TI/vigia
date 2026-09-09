/**
 * Paciente: o get-or-create por nome e a lista de nomes para autocomplete.
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
import type { Prisma } from "@/lib/generated/prisma/client";

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

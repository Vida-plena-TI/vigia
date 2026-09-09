/**
 * Encaminhamentos médicos: cadastro e listagem.
 *
 * A regra de negócio inteira desta tela é uma só — **o encaminhamento vence
 * 180 dias corridos depois da data em que foi feito** — e ela não está escrita
 * em lugar nenhum deste arquivo. Ela vive na coluna gerada
 * `encaminhamento.data_vencimento`
 * (`(data_encaminhamento + INTERVAL '180 days')::date`, migration
 * `20260909130000_encaminhamento`), pela mesma razão que o saldo e o
 * `status_alerta` de uma guia vivem só na view `requisicao_terapia_saldo`:
 * fórmula derivada replicada em TypeScript vira uma segunda fonte de verdade, e
 * as duas divergem no primeiro ajuste que só uma delas receber.
 *
 * Consequência prática para quem mexer aqui: o INSERT nunca menciona
 * `data_vencimento` (o Postgres recusaria, `GENERATED ALWAYS`), e o valor de
 * volta vem do `RETURNING` — não de uma soma feita em JavaScript.
 *
 * As duas colunas `DATE` viajam como texto `"AAAA-MM-DD"` até a tela, como
 * `validade` e `data_atendimento`: virar `Date` faria o dia exibido depender do
 * fuso de quem renderiza, e a data apareceria um dia deslocada.
 */
import { getPrismaClient } from "@/lib/db";
import { OPCOES_DE_TRANSACAO } from "@/lib/db/transacao";
import type { Prisma } from "@/lib/generated/prisma/client";

import {
  ERRO_DATA_INVALIDA,
  ERRO_DATA_OBRIGATORIA,
  ERRO_PACIENTE_OBRIGATORIO,
} from "./encaminhamentos-mensagens";
import { obterOuCriarPaciente } from "./pacientes";

/**
 * Reexportadas para quem consome o domínio não precisar saber que as mensagens
 * moram em um módulo à parte (elas moram lá só para o formulário poder
 * importá-las sem arrastar o Prisma para o cliente).
 */
export * from "./encaminhamentos-mensagens";

/** Uma linha da listagem — as três colunas visíveis, mais o alerta de vencido. */
export type EncaminhamentoNaLista = {
  id: number;
  pacienteNome: string;
  /** "AAAA-MM-DD". */
  dataEncaminhamento: string;
  /** "AAAA-MM-DD", calculada pelo banco. */
  dataVencimento: string;
  /**
   * `true` quando o vencimento já passou.
   *
   * Decidido em SQL contra o `CURRENT_DATE` do banco, não comparando datas em
   * JavaScript: é o mesmo relógio que a view de saldo usa para o alerta de
   * validade, e o relógio do Node (UTC na Vercel) discordaria dele à noite no
   * horário de Brasília. Não é uma coluna a mais na tabela — é só o que decide
   * o destaque visual da coluna de vencimento que já existe.
   */
  vencido: boolean;
};

/** O que o formulário manda para a action, já como tipos, não como texto. */
export type EntradaNovoEncaminhamento = {
  pacienteNome: string;
  /** "AAAA-MM-DD". */
  dataEncaminhamento: string;
};

export type ResultadoCriacao =
  | {
      ok: true;
      id: number;
      pacienteNome: string;
      dataEncaminhamento: string;
      /** Vem do `RETURNING` da coluna gerada — nunca de cálculo em TypeScript. */
      dataVencimento: string;
      /** `false` quando o encaminhamento foi pendurado num paciente já existente. */
      pacienteCriado: boolean;
    }
  | { ok: false; erro: string };

/** Uma data "AAAA-MM-DD" que existe de verdade no calendário. */
function dataValida(data: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return false;
  }

  // `new Date` normaliza silenciosamente ("2026-02-31" vira 03/03). Comparar o
  // ISO de volta é o que rejeita a data que não existe.
  const convertida = new Date(`${data}T00:00:00.000Z`);

  return (
    !Number.isNaN(convertida.getTime()) &&
    convertida.toISOString().slice(0, 10) === data
  );
}

/**
 * Validação que não precisa do banco.
 *
 * É a mesma checagem que o formulário faz — o cliente é conveniência, esta é a
 * que vale, porque a Server Action é alcançável por POST direto.
 */
export function validarEntrada(
  entrada: EntradaNovoEncaminhamento,
): { ok: true } | { ok: false; erro: string } {
  if (!entrada.pacienteNome.trim()) {
    return { ok: false, erro: ERRO_PACIENTE_OBRIGATORIO };
  }

  const data = entrada.dataEncaminhamento.trim();

  if (!data) {
    return { ok: false, erro: ERRO_DATA_OBRIGATORIA };
  }

  if (!dataValida(data)) {
    return { ok: false, erro: ERRO_DATA_INVALIDA };
  }

  return { ok: true };
}

/** O que o `RETURNING` do insert devolve, já com as datas como texto. */
type LinhaInserida = {
  id: number;
  dataEncaminhamento: string;
  dataVencimento: string;
};

/**
 * A criação em si, já dentro de uma transação.
 *
 * Recebe o cliente da transação (em vez de abrir a própria) pelo mesmo motivo
 * de `criarRequisicaoNaTransacao` e `excluirGuiaNaTransacao`: é o que deixa o
 * teste de integração criar de verdade e desfazer tudo no fim.
 *
 * O paciente e o encaminhamento precisam nascer juntos — daí a transação. Um
 * `INSERT` que falhasse depois do get-or-create deixaria um paciente órfão, do
 * mesmo jeito que a criação de requisição evita.
 */
async function criarNaTransacao(
  tx: Prisma.TransactionClient,
  entrada: EntradaNovoEncaminhamento,
): Promise<Extract<ResultadoCriacao, { ok: true }>> {
  const pacienteNome = entrada.pacienteNome.trim();
  const dataEncaminhamento = entrada.dataEncaminhamento.trim();

  const paciente = await obterOuCriarPaciente(tx, pacienteNome);

  // `data_vencimento` não aparece na lista de colunas do INSERT de propósito:
  // ela é `GENERATED ALWAYS`, e o Postgres recusa qualquer tentativa de gravar
  // valor nela. O `RETURNING` é como o valor calculado volta para a tela.
  const [linha] = await tx.$queryRaw<LinhaInserida[]>`
    INSERT INTO "encaminhamento" ("paciente_id", "data_encaminhamento")
    VALUES (${paciente.id}, ${dataEncaminhamento}::date)
    RETURNING
      "id",
      "data_encaminhamento"::text AS "dataEncaminhamento",
      "data_vencimento"::text     AS "dataVencimento"
  `;

  return {
    ok: true,
    id: linha.id,
    pacienteNome: paciente.nome,
    dataEncaminhamento: linha.dataEncaminhamento,
    dataVencimento: linha.dataVencimento,
    pacienteCriado: paciente.criado,
  };
}

/**
 * Cria o encaminhamento inteiro, abrindo a própria transação.
 *
 * Validação sem banco primeiro; depois a transação. É esta a função que a
 * Server Action chama.
 */
export async function criarEncaminhamento(
  entrada: EntradaNovoEncaminhamento,
): Promise<ResultadoCriacao> {
  const validacao = validarEntrada(entrada);

  if (!validacao.ok) {
    return validacao;
  }

  return getPrismaClient().$transaction(
    (tx) => criarNaTransacao(tx, entrada),
    OPCOES_DE_TRANSACAO,
  );
}

/**
 * Versão de {@link criarEncaminhamento} que roda numa transação já aberta.
 *
 * Existe para o teste de integração, que precisa criar de verdade e desfazer
 * tudo no fim. Em produção use {@link criarEncaminhamento}.
 */
export async function criarEncaminhamentoNaTransacao(
  tx: Prisma.TransactionClient,
  entrada: EntradaNovoEncaminhamento,
): Promise<ResultadoCriacao> {
  const validacao = validarEntrada(entrada);

  if (!validacao.ok) {
    return validacao;
  }

  return criarNaTransacao(tx, entrada);
}

/**
 * Todos os encaminhamentos, do mais recente para o mais antigo.
 *
 * A ordem é `data_encaminhamento DESC, id DESC` porque o uso esperado desta
 * tela é cadastrar vários em sequência: o registro recém-criado precisa
 * aparecer no topo da lista, logo abaixo do formulário, sem rolagem. Ordenar
 * por nome (como o painel faz) esconderia no meio da lista a confirmação do que
 * acabou de ser digitado.
 */
export async function listarEncaminhamentos(): Promise<
  EncaminhamentoNaLista[]
> {
  return getPrismaClient().$queryRaw<EncaminhamentoNaLista[]>`
    SELECT
      e."id"                               AS "id",
      p."nome"                             AS "pacienteNome",
      e."data_encaminhamento"::text        AS "dataEncaminhamento",
      e."data_vencimento"::text            AS "dataVencimento",
      (e."data_vencimento" < CURRENT_DATE) AS "vencido"
    FROM "encaminhamento" e
    JOIN "paciente" p ON p."id" = e."paciente_id"
    ORDER BY e."data_encaminhamento" DESC, e."id" DESC
  `;
}

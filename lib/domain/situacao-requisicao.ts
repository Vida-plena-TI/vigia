/**
 * Situação de uma requisição: "solicitada" (enviada ao convênio, em análise)
 * ou "aprovada".
 *
 * A situação é da **requisição** (a pasta numerada), não de cada guia: todas
 * as terapias do mesmo número compartilham a mesma. É dado gravado, alterado
 * só pelo admin — não é calculado, e por isso não mora na view
 * `requisicao_terapia_saldo` nem mexe no `status_alerta`.
 *
 * A fonte de verdade do conjunto de valores é o
 * `CHECK (situacao IN (...))` da tabela `requisicao` (migration
 * `20261026130000_situacao_da_requisicao`). O Prisma não expressa CHECK no
 * schema e a coluna é `String`, então esta constante é o espelho em
 * TypeScript daquela constraint — os dois mudam juntos, como `PAPEIS` em
 * `lib/auth/papel.ts`.
 *
 * Sem nenhum import de banco: o painel e o formulário de atendimento (Client
 * Components) leem daqui.
 */

/** As situações aceitas pelo banco, na mesma ordem do CHECK da migration. */
export const SITUACOES_DE_REQUISICAO = ["solicitada", "aprovada"] as const;

export type SituacaoDeRequisicao = (typeof SITUACOES_DE_REQUISICAO)[number];

/** Situação com que toda requisição nova nasce. */
export const SITUACAO_INICIAL: SituacaoDeRequisicao = "solicitada";

/** Rótulo exibido na tela. */
export const ROTULO_DA_SITUACAO: Record<SituacaoDeRequisicao, string> = {
  solicitada: "Solicitada",
  aprovada: "Aprovada",
};

/**
 * Estreita uma string vinda do banco ou de uma Server Action para
 * `SituacaoDeRequisicao`, sem `as`.
 */
export function ehSituacaoValida(valor: unknown): valor is SituacaoDeRequisicao {
  return (
    typeof valor === "string" &&
    (SITUACOES_DE_REQUISICAO as readonly string[]).includes(valor)
  );
}

/**
 * Aceita apenas o que o CHECK do banco pode ter gravado.
 *
 * Mesma postura de `comoStatusAlerta`: se o banco ganhar uma situação nova e
 * este código não souber dela, é melhor estourar do que tratar a guia como
 * lançável por acidente.
 */
export function comoSituacao(valor: string): SituacaoDeRequisicao {
  if (ehSituacaoValida(valor)) {
    return valor;
  }

  throw new Error(
    `situacao de requisicao inesperada vinda do banco: ${JSON.stringify(valor)}`,
  );
}

/**
 * A requisição aceita lançamento de atendimento **novo**?
 *
 * Só a aprovada. Editar e excluir atendimento que já existe continua
 * permitido em qualquer situação — esta regra vale só para lançar. É a mesma
 * função que o servidor (`lancarLoteNaTransacao`) e a tela de lançamento usam,
 * para os dois não discordarem; a decisão que vale é a do servidor.
 */
export function aceitaLancamento(situacao: SituacaoDeRequisicao): boolean {
  return situacao === "aprovada";
}

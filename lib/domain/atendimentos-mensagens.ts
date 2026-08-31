/**
 * Mensagens de erro do lançamento de atendimento em lote, isoladas do resto do
 * domínio.
 *
 * Mesmo motivo de `requisicoes-mensagens.ts`: o formulário (Client Component) e
 * a validação do servidor precisam mostrar exatamente o mesmo texto, e
 * `lib/domain/atendimentos.ts` importa `@/lib/db` — importá-lo do cliente
 * arrastaria o Prisma para o bundle do navegador.
 *
 * Nada aqui pode importar banco, sessão ou `server-only`.
 */

export const ERRO_PACIENTE_OBRIGATORIO = "Escolha o paciente.";
export const ERRO_DATA_INVALIDA =
  "Data do atendimento inválida. Use uma data real.";
export const ERRO_SEM_SELECAO =
  "Selecione pelo menos uma terapia para lançar.";
export const ERRO_GUIA_INVALIDA = "Guia inválida na seleção.";
export const ERRO_GUIA_DUPLICADA =
  "A mesma guia foi enviada duas vezes no lote. Selecione cada terapia uma única vez.";
export const ERRO_CREDITOS_INVALIDOS =
  "Os créditos consumidos precisam ser um número inteiro maior que zero.";
export const ERRO_ATENDIMENTO_ID_INVALIDO =
  "Identificador de atendimento inválido.";
export const ERRO_ATENDIMENTO_INEXISTENTE = "Atendimento não encontrado.";
export const ERRO_CREDITOS_EDICAO_INVALIDOS =
  "Os créditos consumidos precisam ser um número inteiro maior ou igual a zero.";
export const ERRO_GUIA_INEXISTENTE =
  "Uma das guias selecionadas não existe mais. Recarregue a página e tente de novo.";
export const ERRO_GUIA_DE_OUTRO_PACIENTE =
  "Uma das guias selecionadas não pertence a este paciente. Recarregue a página e tente de novo.";

/**
 * Mensagem de saldo insuficiente.
 *
 * Cobre os dois casos da regra 7 do CONTEXT.md — saldo já esgotado
 * (`saldoRestante <= 0`) e pedido acima do disponível — porque o usuário
 * precisa da mesma informação nos dois: quanto sobrou e quanto ele pediu.
 */
export function erroSaldoInsuficiente(
  terapiaNome: string,
  saldoRestante: number,
  creditosPedidos: number,
): string {
  if (saldoRestante <= 0) {
    return `A guia de ${terapiaNome} não tem mais saldo (restam ${saldoRestante} crédito(s)).`;
  }

  return `A guia de ${terapiaNome} tem apenas ${saldoRestante} crédito(s) de saldo, e o lote pede ${creditosPedidos}.`;
}

/** Mensagem para uma edição que faria a guia passar da quantidade autorizada. */
export function erroEdicaoUltrapassaAutorizado(
  qtdAutorizada: number,
  creditosDosOutrosAtendimentos: number,
  creditosDaEdicao: number,
): string {
  return `A guia autoriza ${qtdAutorizada} crédito(s). Os outros atendimentos já usam ${creditosDosOutrosAtendimentos}, e esta edição pede ${creditosDaEdicao}.`;
}

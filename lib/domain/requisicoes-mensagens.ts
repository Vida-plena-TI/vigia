/**
 * Mensagens de erro do cadastro de requisição, isoladas do resto do domínio.
 *
 * Este módulo existe para que o formulário (Client Component) e a validação do
 * servidor mostrem exatamente o mesmo texto. `lib/domain/requisicoes.ts` não
 * serve para isso: ele importa `@/lib/db`, e importá-lo do cliente arrastaria o
 * Prisma para o bundle do navegador.
 *
 * Nada aqui pode importar banco, sessão ou `server-only`.
 */

export const ERRO_PACIENTE_OBRIGATORIO = "Informe o nome do paciente.";
export const ERRO_NUMERO_OBRIGATORIO = "Informe o número da requisição.";
export const ERRO_SEM_TERAPIA = "Adicione pelo menos uma terapia.";
export const ERRO_TERAPIA_OBRIGATORIA = "Escolha a terapia desta linha.";
export const ERRO_QTD_INVALIDA =
  "A quantidade autorizada precisa ser um número inteiro maior que zero.";
export const ERRO_VALIDADE_INVALIDA = "Validade inválida. Use uma data real.";
export const ERRO_TERAPIA_INEXISTENTE =
  "A terapia escolhida não existe mais. Recarregue a página e tente de novo.";

/** Mensagem do choque com `requisicao_paciente_id_numero_requisicao_key`. */
export function erroNumeroDuplicado(
  numeroRequisicao: string,
  pacienteNome: string,
): string {
  return `O paciente ${pacienteNome} já tem a requisição ${numeroRequisicao}. Use outro número.`;
}

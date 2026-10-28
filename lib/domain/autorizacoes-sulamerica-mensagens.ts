export const ERRO_PACIENTE_OBRIGATORIO = "Informe o nome do paciente.";
export const ERRO_DATA_INVALIDA = "Informe uma data de encaminhamento válida.";
export const ERRO_PRAZO_INVALIDO = "Escolha o prazo: 3, 6 ou 12 meses.";
export const ERRO_ID_INVALIDO = "Identificador de autorização inválido.";
export const ERRO_AUTORIZACAO_INEXISTENTE =
  "Autorização não encontrada. Recarregue a página.";

/** Confirmação do cadastro em `/sulamerica/encaminhamentos` (upsert por paciente). */
export function mensagemDeCadastro(nome: string, substituiu: boolean) {
  return `Encaminhamento ${substituiu ? "atualizado" : "cadastrado"} para ${nome}.`;
}

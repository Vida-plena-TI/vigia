/**
 * Mensagens da carteirinha do convênio e do CRM do médico.
 *
 * Módulo sem **nenhum** import de banco, pelo mesmo motivo de
 * `encaminhamentos-mensagens.ts`: o formulário é Client Component e importa
 * daqui para mostrar o mesmo texto que o servidor devolveria.
 *
 * **Nenhuma mensagem repete o valor digitado.** Carteirinha e CRM são dado de
 * paciente: não vão para log, para mensagem de erro nem para URL. O formato
 * esperado é descrito; o que a pessoa digitou continua no campo, onde ela pode
 * ver e corrigir.
 */

export const ERRO_CARTEIRINHA_OBRIGATORIA = "Informe o número da carteirinha.";

export const ERRO_CARTEIRINHA_INVALIDA =
  "Número da carteirinha inválido. Use de 5 a 25 letras ou números, sem acentos nem símbolos.";

export const ERRO_CRM_OBRIGATORIO = "Informe o CRM do médico.";

export const ERRO_CRM_INVALIDO =
  "CRM inválido. Use só os números, até 10 dígitos, sem a UF.";

const PREFIXO_CARTEIRINHA_DE_OUTRO_PACIENTE =
  "Esta carteirinha já está cadastrada para";

/**
 * Recusa da carteirinha que já pertence a outro paciente.
 *
 * Cita o **nome** do dono, não a carteirinha: quem digitou precisa saber com
 * quem está o conflito para decidir se errou o número ou o paciente.
 */
export function erroCarteirinhaDeOutroPaciente(pacienteNome: string): string {
  return `${PREFIXO_CARTEIRINHA_DE_OUTRO_PACIENTE} ${pacienteNome}.`;
}

/**
 * A mesma recusa, quando o dono não pôde ser lido — o índice único recusou a
 * gravação, mas o paciente que a tinha sumiu antes de o nome ser consultado
 * (excluído no mesmo instante). Raro o bastante para não merecer outra frase.
 */
export const ERRO_CARTEIRINHA_JA_CADASTRADA =
  "Esta carteirinha já está cadastrada para outro paciente.";

/**
 * `true` se a mensagem é sobre o campo da carteirinha — para o formulário
 * marcar o campo certo como inválido, inclusive na recusa que cita o nome.
 */
export function ehErroDaCarteirinha(mensagem: string | undefined): boolean {
  return (
    mensagem === ERRO_CARTEIRINHA_OBRIGATORIA ||
    mensagem === ERRO_CARTEIRINHA_INVALIDA ||
    (mensagem?.startsWith(PREFIXO_CARTEIRINHA_DE_OUTRO_PACIENTE) ?? false)
  );
}

/** `true` se a mensagem é sobre o campo do CRM. */
export function ehErroDoCrm(mensagem: string | undefined): boolean {
  return mensagem === ERRO_CRM_OBRIGATORIO || mensagem === ERRO_CRM_INVALIDO;
}

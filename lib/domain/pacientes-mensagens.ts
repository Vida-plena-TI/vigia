/**
 * Mensagens da exclusão permanente de paciente.
 *
 * Módulo sem **nenhum** import de banco, pelo mesmo motivo de
 * `requisicoes-mensagens.ts` e `encaminhamentos-mensagens.ts`: o diálogo de
 * confirmação é Client Component e importa daqui, e importar
 * `lib/domain/pacientes.ts` do cliente arrastaria o Prisma para o bundle do
 * navegador.
 */

export const ERRO_ID_INVALIDO = "Identificador de paciente inválido.";

export const ERRO_PACIENTE_INEXISTENTE =
  "Paciente não encontrado. A lista pode estar desatualizada — recarregue a página.";

/**
 * A palavra que o usuário digita para liberar o botão de confirmar.
 *
 * Está aqui, e não no componente, porque é o texto que a frase do diálogo
 * precisa citar: pedir uma palavra num lugar e conferir outra em outro é o tipo
 * de divergência que só aparece depois de alguém não conseguir excluir nada.
 *
 * Existe uma alternativa comum a esta — pedir o **nome do paciente**. Não foi
 * ela a escolhida porque o nome já está escrito na própria frase logo acima do
 * campo, a três centímetros de distância: copiá-lo dali é reflexo, não leitura.
 * Uma palavra fixa e estranha ao contexto obriga a sair do piloto automático,
 * que é o ponto inteiro da fricção.
 */
export const PALAVRA_DE_CONFIRMACAO = "EXCLUIR";

/**
 * `true` se o que foi digitado libera a exclusão.
 *
 * Tolera espaço nas pontas e caixa — quem digitou "excluir " entendeu o pedido,
 * e a fricção que interessa é ter de escrever a palavra, não acertar o
 * shift. A tolerância de caixa usa a mesma lógica do índice
 * `UNIQUE (lower(nome))` de paciente: comparar em minúsculas, não normalizar
 * acento (a palavra não tem nenhum, e afrouxar mais só enfraqueceria o portão).
 */
export function confirmacaoValida(digitado: string): boolean {
  return (
    digitado.trim().toLocaleLowerCase("pt-BR") ===
    PALAVRA_DE_CONFIRMACAO.toLocaleLowerCase("pt-BR")
  );
}

/**
 * A frase do diálogo, com as contagens **lidas do banco** — nunca estimadas.
 *
 * As duas contagens vêm de `contarParaExclusao`, consultada no clique e antes
 * de o diálogo aparecer. É a diferença entre avisar o usuário do tamanho real
 * do estrago e mostrar um número plausível: aqui não há como desfazer depois.
 *
 * O plural fica em "(ões)" / "(s)" de propósito, como no resto do sistema
 * ("N encaminhamento(s)", "N crédito(s)"): concordar de verdade exigiria três
 * variantes de frase para ganhar nada em clareza.
 */
export function fraseDeExclusao(
  pacienteNome: string,
  requisicoes: number,
  atendimentos: number,
  temAutorizacaoSulamerica = false,
): string {
  return (
    `Isso vai apagar permanentemente o cadastro de ${pacienteNome}, ` +
    `incluindo ${requisicoes} requisição(ões) e ${atendimentos} atendimento(s). ` +
    (temAutorizacaoSulamerica ? "A autorização SulAmérica também será apagada. " : "") +
    `Essa ação não pode ser desfeita.`
  );
}

/** Confirmação do que a transação de fato apagou. */
export function mensagemDeExclusao(pacienteNome: string): string {
  return `Cadastro de ${pacienteNome} apagado permanentemente.`;
}

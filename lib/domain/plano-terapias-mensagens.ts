/**
 * Mensagens do cadastro de paciente e do plano de terapias.
 *
 * Módulo sem **nenhum** import de banco, pelo mesmo motivo de
 * `requisicoes-mensagens.ts`: o formulário (Client Component) importa daqui
 * para mostrar o mesmo texto que o servidor devolveria.
 *
 * Nenhuma mensagem repete o que foi digitado (nome, horas): o erro aponta o
 * campo, não ecoa o valor.
 */

export const ERRO_PACIENTE_OBRIGATORIO = "Informe o nome do paciente.";

export const ERRO_CONVENIO_INVALIDO = "Escolha o convênio do paciente.";

export const ERRO_SEM_TERAPIA = "Adicione pelo menos uma terapia ao plano.";

export const ERRO_TERAPIA_OBRIGATORIA = "Escolha a terapia desta linha.";

export const ERRO_TERAPIA_REPETIDA =
  "Esta terapia já está em outra linha do plano. Use uma linha só por terapia.";

export const ERRO_TERAPIA_INEXISTENTE =
  "A terapia escolhida não existe mais. Recarregue a página e tente de novo.";

/** Paciente que já tem convênio gravado, e não é o deste cadastro. */
export const ERRO_OUTRO_CONVENIO =
  "Este paciente já está cadastrado no outro convênio.";

/**
 * O paciente foi excluído por outra pessoa entre o get-or-create e a trava da
 * linha. Raro (exige a exclusão permanente no mesmo instante); nada é gravado.
 */
export const ERRO_PACIENTE_EXCLUIDO_AGORA =
  "Este paciente acabou de ser excluído. Recarregue a página antes de cadastrar de novo.";

// Tempo semanal (ver `lib/domain/tempo-semanal.ts`).

export const ERRO_TEMPO_OBRIGATORIO = "Informe as horas por semana.";

export const ERRO_TEMPO_INVALIDO =
  "Horas por semana inválidas. Use um número, como 2 ou 2,5.";

export const ERRO_TEMPO_NAO_POSITIVO =
  "As horas por semana precisam ser maiores que zero.";

export const ERRO_TEMPO_ACIMA_DO_LIMITE =
  "As horas por semana não podem passar de 168 (uma semana inteira).";

export const ERRO_TEMPO_FORA_DO_PASSO =
  "Use horas em passos de 15 minutos (0,25 h), como 1,25 ou 2,5.";

/**
 * A confirmação do cadastro, que diz qual dos caminhos aconteceu: paciente
 * novo, ou plano de um paciente que já existia (substituído inteiro).
 */
export function mensagemDeCadastro(
  pacienteNome: string,
  pacienteCriado: boolean,
): string {
  return pacienteCriado
    ? `Paciente ${pacienteNome} cadastrado com o plano de terapias.`
    : `Plano de terapias de ${pacienteNome} atualizado.`;
}

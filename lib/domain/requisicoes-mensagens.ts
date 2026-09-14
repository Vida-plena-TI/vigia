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

/**
 * Recusa do choque com `requisicao_paciente_id_numero_requisicao_key`.
 *
 * Não é mais a resposta ao número repetido — repetir o número de um paciente
 * agora **anexa** as terapias à requisição que já existe, e o caminho normal
 * nem chega perto da unique. O que sobra para esta mensagem é a corrida: dois
 * cadastros simultâneos do *primeiro* envio daquele número, os dois sem ver
 * linha nenhuma na pré-checagem, os dois tentando inserir. Um ganha, o outro
 * estoura aqui.
 *
 * Por isso o texto pede para reenviar em vez de pedir outro número: reenviar
 * agora funciona — a requisição existe, e a segunda submissão cai no ramo que
 * acrescenta as terapias a ela.
 */
export function erroCorridaNaRequisicao(
  numeroRequisicao: string,
  pacienteNome: string,
): string {
  return `A requisição ${numeroRequisicao} de ${pacienteNome} acabou de ser criada por outro cadastro. Envie de novo para acrescentar as terapias a ela.`;
}

/**
 * A confirmação do cadastro, que **diz qual dos dois caminhos aconteceu**.
 *
 * Mesma ideia de `mensagemDeCadastro` em `encaminhamentos-mensagens.ts`:
 * "criada" e "acrescentada" são eventos diferentes, e quem digitou precisa
 * saber em qual deles caiu. Aqui a diferença é o número da requisição — ele já
 * existia para aquele paciente, e em vez de ser recusado como duplicado
 * recebeu as terapias novas. Sem essa palavra, um número digitado por engano
 * pareceria ter criado uma requisição nova.
 *
 * A distinção vem de olhar se a linha de `requisicao` existia antes de gravar,
 * não de adivinhar pelo resultado.
 */
export function mensagemDeCriacao(
  pacienteNome: string,
  numeroRequisicao: string,
  terapiasAdicionadas: number,
  requisicaoCriada: boolean,
): string {
  if (requisicaoCriada) {
    return `Requisição criada para ${pacienteNome}.`;
  }

  const terapias =
    terapiasAdicionadas === 1
      ? "1 terapia adicionada"
      : `${terapiasAdicionadas} terapias adicionadas`;

  return `${terapias} à requisição ${numeroRequisicao} de ${pacienteNome}.`;
}

/**
 * Recusa do cadastro quando o paciente não tem encaminhamento (regra 15 do
 * CONTEXT.md).
 *
 * A regra é só de **existência**: qualquer encaminhamento serve, inclusive um
 * já vencido. "Estar em dia" é outra pergunta, e ela não é feita aqui.
 */
export const ERRO_SEM_ENCAMINHAMENTO =
  "Paciente sem encaminhamento cadastrado. Cadastre o encaminhamento antes de criar uma requisição.";

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
 * Recusa de um envio que repete a mesma terapia em duas linhas.
 *
 * Uma requisição tem **uma** guia por terapia (UNIQUE
 * `(requisicao_id, terapia_id)`). Duas linhas da mesma terapia no mesmo envio
 * não têm leitura certa — qual das duas quantidades vale? — então o formulário
 * aponta a segunda em vez de escolher por conta própria.
 */
export const ERRO_TERAPIA_REPETIDA_NO_ENVIO =
  "Esta terapia já está em outra linha deste cadastro. Use uma linha só por terapia.";

/**
 * Recusa do choque com `requisicao_terapia_requisicao_id_terapia_id_key`.
 *
 * Mesmo caso de {@link erroCorridaNaRequisicao}, um nível abaixo: o caminho
 * normal olha as guias antes de gravar e atualiza a que já existe, então só
 * chega aqui a corrida — dois envios simultâneos trazendo a mesma terapia
 * nova para a mesma requisição. Reenviar resolve: a guia existe agora, e o
 * envio seguinte cai no ramo que a atualiza.
 */
export function erroCorridaNaGuia(
  numeroRequisicao: string,
  pacienteNome: string,
): string {
  return `Outro cadastro acabou de gravar uma destas terapias na requisição ${numeroRequisicao} de ${pacienteNome}. Envie de novo para atualizar a guia.`;
}

/** "1 terapia adicionada", "2 terapias atualizadas"... */
function contarTerapias(quantidade: number, verbo: string): string {
  return quantidade === 1
    ? `1 terapia ${verbo}`
    : `${quantidade} terapias ${verbo}s`;
}

/**
 * A confirmação do cadastro, que **diz qual dos caminhos aconteceu**.
 *
 * Mesma ideia de `mensagemDeCadastro` em `encaminhamentos-mensagens.ts`:
 * "criada", "adicionada" e "atualizada" são eventos diferentes, e quem digitou
 * precisa saber em qual deles caiu. Numa requisição que já existia, cada
 * terapia do envio ou entrou como guia nova ou **atualizou** a guia que a
 * requisição já tinha dela (quantidade e validade) — e a frase conta as duas
 * coisas separadas. Sem isso, uma terapia repetida por engano pareceria ter
 * criado uma segunda guia, e a quantidade antiga sumiria sem explicação.
 *
 * A distinção vem de olhar o que existia antes de gravar, não de adivinhar
 * pelo resultado.
 */
export function mensagemDeCriacao(
  pacienteNome: string,
  numeroRequisicao: string,
  terapiasAdicionadas: number,
  terapiasAtualizadas: number,
  requisicaoCriada: boolean,
): string {
  if (requisicaoCriada) {
    return `Requisição criada para ${pacienteNome}.`;
  }

  if (terapiasAtualizadas === 0) {
    return `${contarTerapias(terapiasAdicionadas, "adicionada")} à requisição ${numeroRequisicao} de ${pacienteNome}.`;
  }

  if (terapiasAdicionadas === 0) {
    return `${contarTerapias(terapiasAtualizadas, "atualizada")} na requisição ${numeroRequisicao} de ${pacienteNome}.`;
  }

  return `${contarTerapias(terapiasAdicionadas, "adicionada")} e ${terapiasAtualizadas} ${terapiasAtualizadas === 1 ? "atualizada" : "atualizadas"} na requisição ${numeroRequisicao} de ${pacienteNome}.`;
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

/**
 * Recusa do nome que não é de paciente nenhum (desde 28/10/2026).
 *
 * "Nova requisição" não cria paciente: ele só nasce pelo cadastro de
 * encaminhamento. O texto não repete o nome digitado nem sugere parecidos —
 * não confirma nada sobre outros pacientes.
 */
export const ERRO_PACIENTE_NAO_CADASTRADO =
  "Paciente não cadastrado. Cadastre primeiro o encaminhamento em Encaminhamentos.";

export const ERRO_REQUISICAO_ID_INVALIDO =
  "Identificador de requisição inválido.";
export const ERRO_SITUACAO_INVALIDA =
  'Situação inválida. Use "solicitada" ou "aprovada".';
export const ERRO_REQUISICAO_INEXISTENTE =
  "Requisição não encontrada. Recarregue a página e tente de novo.";

/** Confirmação da troca de situação, para o toast do painel. */
export function mensagemDeSituacaoAlterada(
  numeroRequisicao: string,
  situacao: "solicitada" | "aprovada",
): string {
  return situacao === "aprovada"
    ? `Requisição ${numeroRequisicao} aprovada. Já aceita lançamento de atendimento.`
    : `Requisição ${numeroRequisicao} voltou para "Solicitada". Novos lançamentos ficam bloqueados.`;
}

// ---------------------------------------------------------------------------
// Substituição de guias da mesma terapia (desde 29/10/2026)
// ---------------------------------------------------------------------------

export const ROTULO_SUBSTITUIR = "Substituir guias da mesma terapia";

export const APOIO_SUBSTITUIR =
  "Apaga a guia da mesma terapia em requisições antigas deste paciente, com os atendimentos já lançados.";

/**
 * Uma guia que a substituição apaga, como o diálogo e a confirmação a citam.
 *
 * Só os três campos de texto: é o que viaja da prévia para o cliente. O tipo
 * do domínio (`GuiaSubstituida`) tem estes e mais os ids.
 */
export type ItemDeSubstituicao = {
  terapiaNome: string;
  numeroRequisicao: string;
  atendimentos: number;
};

/** "nenhum atendimento", "1 atendimento", "12 atendimentos" (+ sufixo). */
function contarAtendimentos(quantidade: number, apagados: boolean): string {
  if (quantidade === 0) {
    return apagados ? "nenhum atendimento apagado" : "nenhum atendimento";
  }

  if (quantidade === 1) {
    return apagados ? "1 atendimento apagado" : "1 atendimento";
  }

  return apagados
    ? `${quantidade} atendimentos apagados`
    : `${quantidade} atendimentos`;
}

/** "Fono (requisição 333, 12 atendimentos)" — a linha do diálogo. */
export function descreverItemDeSubstituicao(item: ItemDeSubstituicao): string {
  return `${item.terapiaNome} (requisição ${item.numeroRequisicao}, ${contarAtendimentos(item.atendimentos, false)})`;
}

/**
 * Confirmação de um envio que substituiu guias:
 * "Requisição 444 lançada. Substituído: Fono (requisição 333, 12 atendimentos
 * apagados)."
 *
 * Os números citados são os que a **transação** apagou, não os da prévia —
 * entre o diálogo e a gravação o banco pode ter mudado.
 */
export function mensagemDeSubstituicao(
  numeroRequisicao: string,
  itens: readonly ItemDeSubstituicao[],
): string {
  const partes = itens.map(
    (item) =>
      `${item.terapiaNome} (requisição ${item.numeroRequisicao}, ${contarAtendimentos(item.atendimentos, true)})`,
  );

  return `Requisição ${numeroRequisicao} lançada. Substituído: ${partes.join("; ")}.`;
}

/** Aviso das requisições antigas apagadas por ficarem sem guia. */
export function avisoDeRequisicoesApagadas(numeros: readonly string[]): string {
  return numeros.length === 1
    ? `A requisição ${numeros[0]} ficou sem guias e foi apagada.`
    : `As requisições ${numeros.join(", ")} ficaram sem guias e foram apagadas.`;
}

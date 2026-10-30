/**
 * Linhas de terapia de "Nova requisição" e a decisão de quando o plano do
 * paciente pode preenchê-las (regra 26 do CONTEXT.md).
 *
 * Módulo puro, sem React e sem banco: o formulário importa daqui e o teste
 * exercita os casos sem DOM.
 *
 * O plano diz **quais** terapias e, desde a regra 27, sugere a quantidade
 * inicial de cada uma pelo tempo semanal (`quantidadeSugeridaNoMes`: uma
 * autorização por hora cheia, no mínimo uma, × 4 semanas). A validade é a de
 * uma linha nova (hoje + 1 mês). Tudo editável, e nada disso é gravado além do
 * que o usuário enviar.
 *
 * A regra que organiza o resto: **o preenchimento nunca apaga trabalho do
 * usuário.** Ele só troca as linhas quando todas estão vazias ou são linhas que
 * o próprio preenchimento criou e que ninguém editou. Remover uma linha
 * preenchida não conta como edição — as que sobraram continuam intocadas.
 */
import {
  autorizacoesPorSemana,
  formatarMinutosSemanais,
  QUANTIDADE_PADRAO_NO_MES,
  quantidadeSugeridaNoMes,
} from "@/lib/domain/tempo-semanal";

/**
 * Quantidade que uma linha **adicionada à mão** já nasce preenchida, até o
 * usuário mudar. (A linha do plano nasce com a sugestão do tempo semanal.)
 *
 * É só um valor inicial, não um piso nem um limite: o campo continua livre para
 * ser apagado e redigitado, e a validação de "inteiro > 0" (no formulário e na
 * Server Action) não sabe deste número.
 */
export const QTD_AUTORIZADA_PADRAO = String(QUANTIDADE_PADRAO_NO_MES);

/** Os três campos editáveis de uma linha, como texto (é o que um `input` produz). */
export type CamposDaLinha = {
  terapiaId: string;
  qtdAutorizada: string;
  validade: string;
};

/**
 * Uma linha do formulário.
 *
 * Os valores ficam como texto porque é isso que um `input` produz — converter
 * para número aqui só criaria um segundo lugar onde `"3.7"` ou `""` viram algo
 * plausível e errado. A conversão acontece de uma vez só no servidor.
 *
 * `chave` é um contador local, não o índice do array: usar o índice como
 * `key` faria o React reaproveitar o DOM da linha errada ao remover uma linha
 * do meio, e o texto digitado escorregaria para a linha de baixo.
 *
 * `doPlano` guarda os valores com que o preenchimento criou a linha (`null`
 * para linha criada à mão), inclusive a quantidade **sugerida** daquela linha.
 * Comparar com ele é o que diz se o usuário mexeu.
 */
export type LinhaDoFormulario = CamposDaLinha & {
  chave: number;
  doPlano: CamposDaLinha | null;
};

/** Uma terapia do plano, como a action a devolve. */
export type TerapiaDoPlanoNoFormulario = {
  terapiaId: number;
  nome: string;
  minutosSemanais: number;
};

/**
 * Uma linha em branco — exceto pelos dois campos que já nascem sugeridos.
 *
 * `validadePadrao` é "AAAA-MM-DD" a um mês do `CURRENT_DATE` do banco, e chega
 * como argumento em vez de ser calculada aqui: o navegador não tem o relógio
 * que vale (ver `validadePadraoDeGuia` em `lib/domain/requisicoes.ts`). O
 * papel dela é o mesmo de `QTD_AUTORIZADA_PADRAO` — valor inicial, não piso
 * nem limite.
 */
export function linhaNova(
  chave: number,
  validadePadrao: string,
): LinhaDoFormulario {
  return {
    chave,
    terapiaId: "",
    qtdAutorizada: QTD_AUTORIZADA_PADRAO,
    validade: validadePadrao,
    doPlano: null,
  };
}

/**
 * Uma linha por terapia do plano, com a terapia escolhida, a quantidade
 * sugerida pelo tempo semanal dela e a validade de uma linha nova.
 *
 * `chavesAtuais` são reaproveitadas na ordem: a linha que já estava na tela
 * continua sendo o mesmo elemento do DOM com outro valor, então quem estava
 * com o foco num campo dela não o perde. As que faltarem saem de `novaChave`.
 */
export function linhasDoPlano(
  terapias: readonly TerapiaDoPlanoNoFormulario[],
  validadePadrao: string,
  chavesAtuais: readonly number[],
  novaChave: () => number,
): LinhaDoFormulario[] {
  return terapias.map((terapia, indice) => {
    const campos: CamposDaLinha = {
      terapiaId: String(terapia.terapiaId),
      qtdAutorizada: String(quantidadeSugeridaNoMes(terapia.minutosSemanais)),
      validade: validadePadrao,
    };

    return {
      chave: chavesAtuais[indice] ?? novaChave(),
      ...campos,
      doPlano: campos,
    };
  });
}

export type SituacaoDaLinha = "vazia" | "do-plano" | "editada";

/**
 * - `vazia`: nenhuma terapia escolhida e os dois padrões intactos;
 * - `do-plano`: criada pelo preenchimento e com os valores dele — a
 *   quantidade comparada é a **sugerida** daquela linha, não o 4;
 * - `editada`: qualquer outra coisa — linha à mão com algo escolhido ou
 *   mudado, ou linha do plano em que o usuário mexeu.
 */
export function situacaoDaLinha(
  linha: LinhaDoFormulario,
  validadePadrao: string,
): SituacaoDaLinha {
  if (
    linha.doPlano &&
    linha.terapiaId === linha.doPlano.terapiaId &&
    linha.qtdAutorizada === linha.doPlano.qtdAutorizada &&
    linha.validade === linha.doPlano.validade
  ) {
    return "do-plano";
  }

  if (
    linha.terapiaId === "" &&
    linha.qtdAutorizada === QTD_AUTORIZADA_PADRAO &&
    linha.validade === validadePadrao
  ) {
    return "vazia";
  }

  return "editada";
}

/** `true` se alguma linha tem trabalho do usuário que o preenchimento apagaria. */
export function temLinhaEditada(
  linhas: readonly LinhaDoFormulario[],
  validadePadrao: string,
): boolean {
  return linhas.some(
    (linha) => situacaoDaLinha(linha, validadePadrao) === "editada",
  );
}

/**
 * O que fazer com as linhas quando chega o plano do paciente digitado.
 *
 * - `preencher`: o paciente tem plano e nada nas linhas é do usuário — troca
 *   pelas do plano (é também o "trocar de paciente recarrega");
 * - `oferecer`: tem plano, mas há linha editada — nada muda; o botão
 *   "Carregar plano do paciente" fica para o usuário decidir;
 * - `limpar`: sem plano, e as linhas eram as que o preenchimento criou para o
 *   paciente anterior, intocadas — voltam a uma linha em branco, para não
 *   sobrar o plano de outra pessoa;
 * - `manter`: sem plano e nada do preenchimento para desfazer.
 */
export type DecisaoDoPreenchimento =
  | "preencher"
  | "oferecer"
  | "limpar"
  | "manter";

export function decidirPreenchimento(
  linhas: readonly LinhaDoFormulario[],
  validadePadrao: string,
  terapiasDoPlano: readonly TerapiaDoPlanoNoFormulario[],
): DecisaoDoPreenchimento {
  const editada = temLinhaEditada(linhas, validadePadrao);

  if (terapiasDoPlano.length > 0) {
    return editada ? "oferecer" : "preencher";
  }

  const sobrouDoPlano = linhas.some(
    (linha) => situacaoDaLinha(linha, validadePadrao) === "do-plano",
  );

  return !editada && sobrouDoPlano ? "limpar" : "manter";
}

/**
 * O botão "Carregar plano do paciente" pede confirmação só quando vai apagar
 * linha editada à mão. Vazias e intocadas do plano saem sem pergunta.
 */
export function carregarPedeConfirmacao(
  linhas: readonly LinhaDoFormulario[],
  validadePadrao: string,
): boolean {
  return temLinhaEditada(linhas, validadePadrao);
}

/**
 * Chave de comparação de nome no cliente: trim + `toLowerCase()`, a
 * aproximação do `lower(nome)` do Postgres que os formulários de
 * encaminhamento já usam. Serve só para decidir **quando** consultar; quem
 * casa o nome de verdade é o servidor.
 */
export function chaveDoNome(nome: string): string {
  return nome.trim().toLowerCase();
}

/** `true` se o nome digitado é um dos nomes da lista de sugestões. */
export function nomeEstaNaLista(
  nome: string,
  chavesDaLista: ReadonlySet<string>,
): boolean {
  const chave = chaveDoNome(nome);

  return chave !== "" && chavesDaLista.has(chave);
}

/** Espera depois da última tecla antes de consultar o plano. */
export const ESPERA_DA_CONSULTA_MS = 350;

/**
 * Referência somente leitura na linha:
 * "Plano: 2 h por semana · sugestão 2 por semana, 8 no mês".
 */
export function textoDoPlanoNaLinha(minutosSemanais: number): string {
  return `Plano: ${formatarMinutosSemanais(minutosSemanais)} por semana · sugestão ${autorizacoesPorSemana(minutosSemanais)} por semana, ${quantidadeSugeridaNoMes(minutosSemanais)} no mês`;
}

/** Anúncio para leitor de tela depois de preencher. */
export function anuncioDePlanoCarregado(quantidade: number): string {
  return `Plano carregado: ${quantidade} ${quantidade === 1 ? "terapia" : "terapias"}, com quantidades sugeridas pelo plano.`;
}

export const ANUNCIO_SEM_PLANO = "Paciente sem plano cadastrado.";

export const ANUNCIO_PLANO_OFERECIDO =
  "Plano do paciente disponível. Suas linhas foram mantidas; use Carregar plano do paciente para trocá-las.";

export const AVISO_SEM_PLANO =
  "Este paciente não tem plano de terapias cadastrado.";

export const AVISO_LINHAS_EDITADAS =
  "Você já editou as linhas, então elas não foram trocadas. Carregar o plano substitui todas pelas terapias do plano.";

export const ERRO_AO_CARREGAR_PLANO =
  "Não foi possível carregar o plano do paciente. Adicione as terapias à mão.";

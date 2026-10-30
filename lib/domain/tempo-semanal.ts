/**
 * Tempo semanal de uma terapia no plano do paciente: o formulário recebe
 * **horas** como texto ("2", "2,5", "2.5", "0,25") e o banco guarda
 * **minutos inteiros** (`plano_terapia.minutos_semanais`).
 *
 * Espelho do CHECK `plano_terapia_minutos_semanais_validos` da migration
 * `20261029120000_convenio_e_plano_de_terapias`: maior que zero, no máximo uma
 * semana (168 h = 10080 min) e em passos de 15 minutos. Os dois mudam no mesmo
 * commit.
 *
 * Módulo puro, sem banco: servidor e formulário chamam as mesmas funções.
 *
 * A conversão é feita com inteiros, não com `Number("2,5") * 60`: ponto
 * flutuante não erra 0,25, mas "0,1" * 60 daria 6.000000000000001 e o teste de
 * múltiplo de 15 passaria a depender de arredondamento. Aqui a parte decimal é
 * lida como dígitos e a conta é exata.
 */
import {
  ERRO_TEMPO_ACIMA_DO_LIMITE,
  ERRO_TEMPO_FORA_DO_PASSO,
  ERRO_TEMPO_INVALIDO,
  ERRO_TEMPO_NAO_POSITIVO,
  ERRO_TEMPO_OBRIGATORIO,
} from "./plano-terapias-mensagens";

/** 168 horas: o limite do CHECK. */
export const MINUTOS_SEMANAIS_MAXIMO = 7 * 24 * 60;

/** Passo do CHECK (`minutos_semanais % 15 = 0`). */
export const PASSO_EM_MINUTOS = 15;

export type ResultadoDoTempo =
  | { ok: true; minutos: number }
  | { ok: false; erro: string };

/**
 * Converte o texto digitado em horas para minutos inteiros, ou devolve o erro.
 *
 * Aceita vírgula ou ponto como separador decimal e espaço nas pontas. Recusa
 * vazio, texto, sinal, notação científica, zero, mais de 168 h e o que não cair
 * em passo de 15 minutos.
 */
export function lerHorasSemanais(texto: string): ResultadoDoTempo {
  const limpo = texto.trim();

  if (!limpo) {
    return { ok: false, erro: ERRO_TEMPO_OBRIGATORIO };
  }

  // Sinal negativo é um número, só que fora da faixa: a mensagem certa é a do
  // "maior que zero", não a de texto inválido.
  const negativo = /^-\s*\d+(?:[.,]\d+)?$/.test(limpo);

  if (negativo) {
    return { ok: false, erro: ERRO_TEMPO_NAO_POSITIVO };
  }

  const partes = /^(\d+)(?:[.,](\d+))?$/.exec(limpo);

  if (!partes) {
    return { ok: false, erro: ERRO_TEMPO_INVALIDO };
  }

  const inteira = partes[1].replace(/^0+(?=\d)/, "");
  const decimal = (partes[2] ?? "").replace(/0+$/, "");

  // Mais de três dígitos inteiros (sem zeros à esquerda) já passa de 168 h; o
  // corte evita converter números enormes.
  if (inteira.length > 3) {
    return { ok: false, erro: ERRO_TEMPO_ACIMA_DO_LIMITE };
  }

  // Múltiplos de 0,25 h têm no máximo duas casas decimais significativas.
  if (decimal.length > 2) {
    return { ok: false, erro: ERRO_TEMPO_FORA_DO_PASSO };
  }

  // horas = inteira + decimal / 100 (com a decimal completada a duas casas);
  // minutos = horas * 60 = (inteira * 100 + centesimos) * 60 / 100.
  const centesimos = Number(inteira) * 100 + Number(decimal.padEnd(2, "0"));
  const minutosVezes100 = centesimos * 60;

  if (centesimos === 0) {
    return { ok: false, erro: ERRO_TEMPO_NAO_POSITIVO };
  }

  if (minutosVezes100 > MINUTOS_SEMANAIS_MAXIMO * 100) {
    return { ok: false, erro: ERRO_TEMPO_ACIMA_DO_LIMITE };
  }

  if (minutosVezes100 % (PASSO_EM_MINUTOS * 100) !== 0) {
    return { ok: false, erro: ERRO_TEMPO_FORA_DO_PASSO };
  }

  return { ok: true, minutos: minutosVezes100 / 100 };
}

/**
 * Minutos por semana para leitura: "2 h", "2 h 30 min", "45 min".
 *
 * Só formata um valor gravado; não soma nem arredonda nada.
 */
export function formatarMinutosSemanais(minutos: number): string {
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;

  if (horas === 0) {
    return `${resto} min`;
  }

  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
}

/**
 * Minutos gravados de volta para o texto em horas que o formulário aceita
 * ("2", "2,5", "1,25", "0,75") — para o "Editar" da aba Cadastro preencher o
 * campo. É o inverso exato de {@link lerHorasSemanais} para todo valor que o
 * CHECK aceita (múltiplos de 15 min), com a mesma conta em inteiros.
 */
export function minutosParaHorasDigitadas(minutos: number): string {
  const horas = Math.floor(minutos / 60);
  // Múltiplo de 15 min → 0, 25, 50 ou 75 centésimos de hora, sem resto.
  const centesimos = ((minutos % 60) * 100) / 60;

  if (centesimos === 0) {
    return String(horas);
  }

  return `${horas},${String(centesimos).padStart(2, "0").replace(/0+$/, "")}`;
}

/**
 * Semanas que um mês conta para a sugestão de quantidade (regra 27): sempre 4,
 * sem olhar o calendário.
 */
export const SEMANAS_POR_MES = 4;

/**
 * Quantidade de uma guia quando não há tempo semanal que sirva: a mesma das
 * linhas de "Nova requisição" adicionadas à mão.
 */
export const QUANTIDADE_PADRAO_NO_MES = 4;

/** Um minuto inteiro positivo; o resto é entrada que não dá para usar. */
function ehMinutosValidos(minutos: number): boolean {
  return Number.isSafeInteger(minutos) && minutos >= 1;
}

/**
 * Autorizações por semana sugeridas pelo tempo do plano (regra 27): uma por
 * **hora cheia**, no mínimo uma. 30 min, 1 h e 1 h 30 min dão 1; 2 h e
 * 2 h 30 min dão 2; 3 h dá 3. A fração de hora não arredonda para cima.
 *
 * Entrada inválida (não inteira, zero, negativa, `NaN`) devolve 1, o mínimo:
 * nunca zero, negativo nem `NaN`.
 *
 * É **sugestão** de valor inicial no formulário, nada mais: não é gravada, não
 * entra em view nem em guia.
 */
export function autorizacoesPorSemana(minutos: number): number {
  if (!ehMinutosValidos(minutos)) {
    return 1;
  }

  return Math.max(1, Math.floor(minutos / 60));
}

/**
 * Quantidade autorizada sugerida para o mês: {@link autorizacoesPorSemana} ×
 * {@link SEMANAS_POR_MES}. Entrada inválida devolve
 * {@link QUANTIDADE_PADRAO_NO_MES} (4).
 */
export function quantidadeSugeridaNoMes(minutos: number): number {
  if (!ehMinutosValidos(minutos)) {
    return QUANTIDADE_PADRAO_NO_MES;
  }

  return autorizacoesPorSemana(minutos) * SEMANAS_POR_MES;
}

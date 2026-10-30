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
 * Desde 30/10/2026 a aba Cadastro não pede mais o texto em horas: a linha tem
 * a caixa "Tempo por semana" (opções prontas e "Outro" com horas inteiras +
 * minutos, ver {@link EstadoDoTempo}) e envia o texto em horas gerado a partir
 * dos minutos ({@link horasParaEnvio}). O servidor continua lendo e validando
 * por {@link lerHorasSemanais}.
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

/**
 * Tempo de uma linha nova da aba Cadastro: toda terapia acrescentada ao plano
 * nasce com 30 minutos escolhidos. Vale só para linha nova — a linha que vem de
 * um plano gravado ("Editar") abre com o tempo dela.
 */
export const MINUTOS_PADRAO_DA_LINHA_NOVA = 30;

/** As opções prontas da caixa "Tempo por semana", nesta ordem. */
export const OPCOES_DE_TEMPO_PRONTAS = [
  { minutos: 30, rotulo: "30 minutos" },
  { minutos: 60, rotulo: "1 hora" },
  { minutos: 90, rotulo: "1 hora e meia" },
  { minutos: 120, rotulo: "2 horas" },
  { minutos: 150, rotulo: "2 horas e meia" },
] as const;

/** Rótulo da opção que abre os campos "Horas" e "Minutos". */
export const ROTULO_OUTRO_TEMPO = "Outro (digitar)";

/** Os minutos que o "Outro" oferece ao lado das horas: o passo de 15. */
export const MINUTOS_DO_OUTRO = [0, 15, 30, 45] as const;

/**
 * O que a caixa "Tempo por semana" mostra: uma opção pronta, ou "Outro" com as
 * horas como digitadas (texto, para o campo poder ficar vazio) e os minutos
 * escolhidos.
 */
export type EstadoDoTempo =
  | { tipo: "pronta"; minutos: number }
  | { tipo: "outro"; horas: string; minutos: number };

/** O estado de uma linha nova: {@link MINUTOS_PADRAO_DA_LINHA_NOVA}. */
export function estadoDoTempoPadrao(): EstadoDoTempo {
  return { tipo: "pronta", minutos: MINUTOS_PADRAO_DA_LINHA_NOVA };
}

/** O estado logo depois de escolher "Outro": horas vazias e 0 minutos. */
export function estadoDoOutroVazio(): EstadoDoTempo {
  return { tipo: "outro", horas: "", minutos: 0 };
}

/**
 * Minutos gravados → o que a caixa mostra no "Editar". Igual a uma opção
 * pronta, mostra a opção; senão, "Outro" já com horas e minutos — nunca troca
 * nem arredonda o valor gravado.
 */
export function opcaoDoTempo(minutos: number): EstadoDoTempo {
  if (OPCOES_DE_TEMPO_PRONTAS.some((opcao) => opcao.minutos === minutos)) {
    return { tipo: "pronta", minutos };
  }

  return {
    tipo: "outro",
    horas: String(Math.floor(minutos / 60)),
    minutos: minutos % 60,
  };
}

/** As regras de {@link lerHorasSemanais}, já em minutos inteiros. */
function validarMinutos(minutos: number): ResultadoDoTempo {
  if (!Number.isSafeInteger(minutos)) {
    return { ok: false, erro: ERRO_TEMPO_INVALIDO };
  }

  if (minutos <= 0) {
    return { ok: false, erro: ERRO_TEMPO_NAO_POSITIVO };
  }

  if (minutos > MINUTOS_SEMANAIS_MAXIMO) {
    return { ok: false, erro: ERRO_TEMPO_ACIMA_DO_LIMITE };
  }

  if (minutos % PASSO_EM_MINUTOS !== 0) {
    return { ok: false, erro: ERRO_TEMPO_FORA_DO_PASSO };
  }

  return { ok: true, minutos };
}

/**
 * O estado da caixa → minutos por semana, ou o erro — as mesmas mensagens do
 * servidor. No "Outro", as horas são um inteiro de 0 a 168, sem vírgula nem
 * decimal (vazio é "informe"), e os minutos, um de {@link MINUTOS_DO_OUTRO}.
 *
 * É conveniência da tela: quem decide é {@link lerHorasSemanais}, no servidor.
 */
export function minutosDoEstado(estado: EstadoDoTempo): ResultadoDoTempo {
  if (estado.tipo === "pronta") {
    return validarMinutos(estado.minutos);
  }

  const horas = estado.horas.trim();

  if (!horas) {
    return { ok: false, erro: ERRO_TEMPO_OBRIGATORIO };
  }

  if (!/^\d+$/.test(horas)) {
    return { ok: false, erro: ERRO_TEMPO_INVALIDO };
  }

  // Mais de três dígitos (sem zeros à esquerda) já passa de 168 h.
  if (horas.replace(/^0+(?=\d)/, "").length > 3) {
    return { ok: false, erro: ERRO_TEMPO_ACIMA_DO_LIMITE };
  }

  if (!(MINUTOS_DO_OUTRO as readonly number[]).includes(estado.minutos)) {
    return { ok: false, erro: ERRO_TEMPO_FORA_DO_PASSO };
  }

  return validarMinutos(Number(horas) * 60 + estado.minutos);
}

/**
 * O texto que a linha envia no campo `horas` — o que a Server Action já lê e
 * {@link lerHorasSemanais} valida. Estado válido vira o texto em horas exato
 * ({@link minutosParaHorasDigitadas}: 90 → "1,5", 195 → "3,25"); estado
 * inválido envia vazio, que o servidor recusa (a tela já barrou antes).
 */
export function horasParaEnvio(estado: EstadoDoTempo): string {
  const tempo = minutosDoEstado(estado);

  return tempo.ok ? minutosParaHorasDigitadas(tempo.minutos) : "";
}

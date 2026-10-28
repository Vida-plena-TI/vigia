/**
 * Carteirinha do convênio e CRM do médico: normalização e validação.
 *
 * Funções puras, sem nenhum import de banco — o formulário (Client Component)
 * usa as mesmas que o servidor, e o teste unitário não precisa de Postgres.
 *
 * A fonte de verdade dos formatos é o `CHECK` da tabela `paciente` (migration
 * `20261028120000_carteirinha_e_crm_do_paciente`). As regex daqui são o
 * espelho dele, como `PAPEIS` é o de `usuario.papel`: os dois mudam no mesmo
 * commit. O banco recusa o que escapar daqui; o domínio existe para recusar
 * antes, com uma frase em português em vez de um código de erro.
 *
 * Normalizar é tirar o que a pessoa costuma digitar a mais e que não faz parte
 * do número — espaço (inclusive no meio, de quem copia "1234 5678 9012" do
 * cartão) e, no CRM, o ponto de milhar ("123.456"). Nada além disso: hífen,
 * barra e a UF do CRM ("CRM/SP") **não** são removidos em silêncio, porque
 * adivinhar o que sobra deles poderia gravar um número diferente do que está
 * no documento. Esses casos caem na validação e a pessoa corrige.
 *
 * A caixa da carteirinha é gravada como veio. A unicidade é sem caixa
 * (`UNIQUE (lower(numero_carteirinha))`), então "ab123" e "AB123" são a mesma
 * carteirinha para o banco — não há o que ganhar reescrevendo o que foi
 * digitado.
 */

import {
  ERRO_CARTEIRINHA_INVALIDA,
  ERRO_CARTEIRINHA_OBRIGATORIA,
  ERRO_CRM_INVALIDO,
  ERRO_CRM_OBRIGATORIO,
} from "./carteirinha-crm-mensagens";

export * from "./carteirinha-crm-mensagens";

/** Espelho do CHECK `paciente_numero_carteirinha_formato`. */
export const FORMATO_DA_CARTEIRINHA = /^[A-Za-z0-9]{5,25}$/;

/** Espelho do CHECK `paciente_crm_medico_formato`. */
export const FORMATO_DO_CRM = /^[0-9]{1,10}$/;

export type ResultadoDeNormalizacao =
  { ok: true; valor: string } | { ok: false; erro: string };

/** Trim e remoção de todo espaço interno (inclusive o não separável). */
export function normalizarCarteirinha(texto: string): string {
  return texto.replace(/\s+/g, "");
}

/** Trim e remoção de pontos e espaços. */
export function normalizarCrm(texto: string): string {
  return texto.replace(/[\s.]+/g, "");
}

/** Normaliza e valida a carteirinha; devolve o valor que deve ser gravado. */
export function validarCarteirinha(texto: string): ResultadoDeNormalizacao {
  const valor = normalizarCarteirinha(texto);

  if (!valor) {
    return { ok: false, erro: ERRO_CARTEIRINHA_OBRIGATORIA };
  }

  if (!FORMATO_DA_CARTEIRINHA.test(valor)) {
    return { ok: false, erro: ERRO_CARTEIRINHA_INVALIDA };
  }

  return { ok: true, valor };
}

/** Normaliza e valida o CRM; devolve o valor que deve ser gravado. */
export function validarCrm(texto: string): ResultadoDeNormalizacao {
  const valor = normalizarCrm(texto);

  if (!valor) {
    return { ok: false, erro: ERRO_CRM_OBRIGATORIO };
  }

  if (!FORMATO_DO_CRM.test(valor)) {
    return { ok: false, erro: ERRO_CRM_INVALIDO };
  }

  return { ok: true, valor };
}

/**
 * Nome do médico do encaminhamento SulAmérica: normalização e validação.
 *
 * Função pura, sem nenhum import de banco — o formulário (Client Component)
 * usa a mesma que o servidor, como em `carteirinha-crm.ts`.
 *
 * A garantia de quem grava por fora do domínio é o `CHECK` de
 * `autorizacao_sulamerica.nome_medico` (migration
 * `20261028140000_nome_do_medico_sulamerica`): 3 a 120 caracteres depois do
 * trim. As regras daqui são mais estritas que o CHECK (letra obrigatória, sem
 * caractere de controle) e incluem a dele; os dois mudam no mesmo commit.
 *
 * Normalizar é só tirar espaço a mais — nas pontas e repetido no meio (tab,
 * quebra de linha e espaço não separável contam como espaço). A caixa é
 * gravada como veio: "dra. maria" não vira "Dra. Maria", porque adivinhar a
 * grafia de um nome próprio erra mais do que acerta.
 *
 * Acentos, ponto, apóstrofo e hífen são aceitos ("Dr. João D'Ávila-Silva").
 *
 * **A mensagem de erro nunca repete o que foi digitado**, e o nome não vai
 * para log nem URL — por precaução, como carteirinha e CRM.
 */

export const NOME_MEDICO_MINIMO = 3;
export const NOME_MEDICO_MAXIMO = 120;

export const ERRO_NOME_MEDICO_OBRIGATORIO = "Informe o nome do médico.";

export const ERRO_NOME_MEDICO_INVALIDO =
  `Nome do médico inválido. Use de ${NOME_MEDICO_MINIMO} a ${NOME_MEDICO_MAXIMO} caracteres, com letras.`;

export type ResultadoDoNomeMedico =
  { ok: true; valor: string } | { ok: false; erro: string };

/** Trim e colapso de todo espaço interno (inclusive tab e não separável). */
export function normalizarNomeMedico(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

/** Normaliza e valida; devolve o valor que deve ser gravado. */
export function validarNomeMedico(texto: unknown): ResultadoDoNomeMedico {
  // Server Actions aceitam POST direto: o tipo é conferido em runtime.
  const valor = typeof texto === "string" ? normalizarNomeMedico(texto) : "";

  if (!valor) {
    return { ok: false, erro: ERRO_NOME_MEDICO_OBRIGATORIO };
  }

  // Em pontos de código, como o `char_length` do CHECK.
  const tamanho = [...valor].length;

  if (
    tamanho < NOME_MEDICO_MINIMO ||
    tamanho > NOME_MEDICO_MAXIMO ||
    !/\p{L}/u.test(valor) ||
    /[\p{Cc}\p{Cf}]/u.test(valor)
  ) {
    return { ok: false, erro: ERRO_NOME_MEDICO_INVALIDO };
  }

  return { ok: true, valor };
}

/** `true` se a mensagem é sobre o campo do nome do médico. */
export function ehErroDoNomeMedico(mensagem: string | undefined): boolean {
  return (
    mensagem === ERRO_NOME_MEDICO_OBRIGATORIO ||
    mensagem === ERRO_NOME_MEDICO_INVALIDO
  );
}

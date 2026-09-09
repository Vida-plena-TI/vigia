"use server";

/**
 * Server Actions da exclusão permanente de paciente.
 *
 * As duas funções daqui são alcançáveis por um POST direto, sem passar pela UI
 * — por isso a regra 4 do CONTEXT.md (`requireUsuario()`) vale para as duas, e
 * vale com mais força aqui do que em qualquer outra action do sistema: esta é a
 * única que apaga dados sem forma de desfazer.
 *
 * A fricção do diálogo (ver o que será apagado, digitar a palavra de
 * confirmação) é do cliente, e o cliente pode ser contornado. O que **não** é
 * contornável é a autenticação e a validação do id, que moram aqui e em
 * `lib/domain/pacientes.ts`. Um POST montado à mão com um id válido apaga o
 * paciente, do mesmo jeito que um POST montado à mão exclui uma guia — a
 * diferença é o tamanho da consequência, e é ela que está registrada em
 * CONTEXT.md como decisão consciente.
 *
 * O par contagem/exclusão é deliberado: a contagem acontece **antes** do
 * diálogo aparecer, para a frase citar números lidos do banco em vez de
 * estimativas.
 */

import { refresh } from "next/cache";

import { requireUsuario } from "@/lib/auth/current-user";

import {
  contarParaExclusao,
  excluirPacientePeloId,
  type ResultadoDaContagem,
  type ResultadoDaExclusao,
} from "./pacientes";

/**
 * O que será apagado, para o diálogo de confirmação.
 *
 * Leitura pura: não altera nada e não chama `refresh()`. É chamada no clique do
 * botão "Excluir", e o diálogo só abre depois que ela volta.
 */
export async function contarParaExcluirPaciente(
  pacienteId: number,
): Promise<ResultadoDaContagem> {
  await requireUsuario();

  return contarParaExclusao(pacienteId);
}

/**
 * Apaga permanentemente o paciente e tudo que pende dele.
 *
 * Devolve o erro em vez de lançar: a falha esperada aqui (o paciente já não
 * existe, porque a lista estava velha) é uma mensagem para o usuário, não uma
 * exceção. Qualquer outra falha lança e a transação volta atrás inteira.
 */
export async function excluirPaciente(
  pacienteId: number,
): Promise<ResultadoDaExclusao> {
  await requireUsuario();

  const resultado = await excluirPacientePeloId(pacienteId);

  if (resultado.ok) {
    // Nada é cacheado (as páginas são dinâmicas por causa da sessão); o refresh
    // é para o router do cliente redesenhar a listagem sem a linha apagada.
    refresh();
  }

  return resultado;
}

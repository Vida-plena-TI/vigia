"use server";

/**
 * Server Actions do lançamento de atendimento.
 *
 * Como toda action do projeto, as duas são alcançáveis por um POST direto sem
 * passar pela UI — por isso `requireUsuario()` (regra 4 do CONTEXT.md) vem
 * antes de qualquer leitura, e a validação de verdade mora em
 * `lib/domain/atendimentos.ts`, não no JavaScript da página.
 *
 * Os itens do lote viajam como campos repetidos (`requisicaoTerapiaId`,
 * `creditosConsumidos`), um par por terapia marcada. `getAll` devolve os dois
 * vetores na ordem do DOM, e eles são costurados por índice.
 */

import { refresh } from "next/cache";

import { requireUsuario } from "@/lib/auth/current-user";

import {
  editarAtendimentoPeloId,
  excluirAtendimentoPeloId,
  lancarLote,
  listarGuiasDisponiveisDoPaciente,
  type EntradaDeEdicaoDeAtendimento,
  type EntradaDeLote,
  type GuiaDisponivel,
  type ItemDoLote,
  type ResultadoEdicaoDeAtendimento,
  type ResultadoExclusaoDeAtendimento,
} from "./atendimentos";

/** Estado que o formulário lê de volta via `useActionState`. */
export type EstadoDoLancamento = {
  erro?: string;
  /** Índice do item culpado, quando o erro é de uma terapia específica. */
  item?: number;
  /** Presente só no sucesso. É ele que dispara a limpeza do formulário. */
  sucesso?: {
    totalDeAtendimentos: number;
    totalDeCreditos: number;
    pacienteNome: string;
    /**
     * Identificador do lançamento, único por submissão.
     *
     * O formulário guarda o último token que já tratou. Sem isso, dois lotes
     * seguidos com exatamente os mesmos números produziriam estados iguais e o
     * segundo poderia não disparar a limpeza — e o efeito rodaria duas vezes
     * no StrictMode.
     */
    token: string;
  };
};

export type EntradaDeEdicaoDeAtendimentoAction = {
  atendimentoId: number;
  dataAtendimento: string;
  /**
   * Texto vindo do input. A action converte com regex para não transformar
   * campo vazio, decimal ou notação científica em número válido por acidente.
   */
  creditosConsumidos: string;
  observacao: string;
};

/**
 * Guias com saldo de um paciente, para o formulário montar a lista de
 * terapias quando o paciente é escolhido.
 *
 * É uma Server Function de leitura, chamada direto do Client Component (mesmo
 * padrão de `listarHistoricoDaGuia`) — não há motivo para um Route Handler só
 * para isso.
 */
export async function carregarGuiasDoPaciente(
  pacienteId: number,
): Promise<GuiaDisponivel[]> {
  await requireUsuario();

  return listarGuiasDisponiveisDoPaciente(pacienteId);
}

/**
 * Converte texto de formulário para inteiro **sem** as conversões silenciosas
 * do `Number` ("", " ", "3.7", "1e3" viram números plausíveis e errados).
 *
 * Devolve `NaN` no que não for um inteiro literal; quem valida é
 * `validarLote`.
 */
function paraInteiro(valor: unknown): number {
  const texto = String(valor ?? "").trim();

  return /^-?\d+$/.test(texto) ? Number(texto) : Number.NaN;
}

/** Lê os itens do lote dos campos repetidos do formulário. */
function lerItens(formData: FormData): ItemDoLote[] {
  const guias = formData.getAll("requisicaoTerapiaId");
  const creditos = formData.getAll("creditosConsumidos");

  // Os dois vetores têm o mesmo tamanho quando vêm do formulário: o checkbox
  // só é enviado quando marcado, e o campo de créditos ao lado dele fica
  // `disabled` (portanto fora do envio) enquanto a terapia não está marcada.
  // Um POST montado à mão pode mandá-los desalinhados; usar o maior faz o item
  // incompleto cair na validação em vez de ser costurado em silêncio com o
  // valor do item vizinho.
  const total = Math.max(guias.length, creditos.length);
  const itens: ItemDoLote[] = [];

  for (let indice = 0; indice < total; indice += 1) {
    itens.push({
      requisicaoTerapiaId: paraInteiro(String(guias[indice] ?? "")),
      creditosConsumidos: paraInteiro(String(creditos[indice] ?? "")),
    });
  }

  return itens;
}

/**
 * Lança o lote de atendimentos.
 *
 * Não há `redirect` aqui, de propósito (item 4 do Prompt 6): o usuário fica na
 * tela para lançar o próximo paciente sem esperar uma navegação. O `refresh()`
 * existe porque a página é um Server Component — depois do lançamento, um
 * paciente pode ter esgotado a última guia e precisa sumir do `select`.
 *
 * Falha -> devolve a mensagem para o formulário, que continua na tela com tudo
 * que o usuário marcou.
 */
export async function lancarAtendimentos(
  _prev: EstadoDoLancamento,
  formData: FormData,
): Promise<EstadoDoLancamento> {
  await requireUsuario();

  const entrada: EntradaDeLote = {
    pacienteId: paraInteiro(String(formData.get("pacienteId") ?? "")),
    dataAtendimento: String(formData.get("dataAtendimento") ?? "").trim(),
    observacao: String(formData.get("observacao") ?? ""),
    itens: lerItens(formData),
  };

  const resultado = await lancarLote(entrada);

  if (!resultado.ok) {
    return { erro: resultado.erro, item: resultado.item };
  }

  refresh();

  return {
    sucesso: {
      totalDeAtendimentos: resultado.totalDeAtendimentos,
      totalDeCreditos: resultado.totalDeCreditos,
      // O nome vem do formulário só para a mensagem; nenhuma decisão depende
      // dele — o paciente que vale é o `pacienteId` já validado no domínio.
      pacienteNome: String(formData.get("pacienteNome") ?? "").trim(),
      token: crypto.randomUUID(),
    },
  };
}

/** Edita um atendimento existente (regra 8 do CONTEXT.md). */
export async function editarAtendimento(
  entrada: EntradaDeEdicaoDeAtendimentoAction,
): Promise<ResultadoEdicaoDeAtendimento> {
  await requireUsuario();

  const dados: EntradaDeEdicaoDeAtendimento = {
    atendimentoId: paraInteiro(entrada.atendimentoId),
    dataAtendimento: String(entrada.dataAtendimento ?? "").trim(),
    creditosConsumidos: paraInteiro(entrada.creditosConsumidos),
    observacao: String(entrada.observacao ?? ""),
  };

  const resultado = await editarAtendimentoPeloId(dados);

  if (resultado.ok) {
    refresh();
  }

  return resultado;
}

/** Exclui um atendimento existente. */
export async function excluirAtendimento(
  atendimentoId: number,
): Promise<ResultadoExclusaoDeAtendimento> {
  await requireUsuario();

  const resultado = await excluirAtendimentoPeloId(paraInteiro(atendimentoId));

  if (resultado.ok) {
    refresh();
  }

  return resultado;
}

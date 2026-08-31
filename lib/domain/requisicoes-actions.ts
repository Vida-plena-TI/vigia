"use server";

/**
 * Server Action do cadastro de nova requisição.
 *
 * Como toda action do projeto, é alcançável por um POST direto sem passar pela
 * UI — por isso `requireUsuario()` (regra 4 do CONTEXT.md) vem antes de
 * qualquer leitura do formulário, e a validação de verdade mora em
 * `lib/domain/requisicoes.ts`, não no JavaScript da página.
 *
 * As linhas de terapia viajam como campos repetidos (`terapiaId`,
 * `qtdAutorizada`, `validade`), um por linha renderizada. `getAll` devolve os
 * três vetores na ordem do DOM, e eles são costurados por índice.
 */

import { redirect } from "next/navigation";

import { requireUsuario } from "@/lib/auth/current-user";

import {
  criarRequisicao,
  type EntradaNovaRequisicao,
  type LinhaDeTerapia,
} from "./requisicoes";

/** Estado que o formulário lê de volta via `useActionState`. */
export type EstadoNovaRequisicao = {
  erro?: string;
  /** Índice da linha de terapia culpada, quando o erro é de uma linha. */
  linha?: number;
};

/**
 * Converte texto de formulário para inteiro **sem** as conversões silenciosas
 * do `Number` ("", " ", "3.7", "1e3" viram números plausíveis e errados).
 *
 * Devolve `NaN` no que não for um inteiro literal; quem valida é
 * `validarEntrada`.
 */
function paraInteiro(valor: string): number {
  const texto = valor.trim();

  return /^-?\d+$/.test(texto) ? Number(texto) : Number.NaN;
}

/** Lê as linhas de terapia dos campos repetidos do formulário. */
function lerLinhas(formData: FormData): LinhaDeTerapia[] {
  const terapias = formData.getAll("terapiaId");
  const quantidades = formData.getAll("qtdAutorizada");
  const validades = formData.getAll("validade");

  // Os três vetores têm o mesmo tamanho quando vêm do formulário. Um POST
  // montado à mão pode mandá-los desalinhados; usar o maior faz a linha
  // incompleta cair na validação em vez de ser costurada em silêncio com o
  // valor da linha vizinha.
  const total = Math.max(
    terapias.length,
    quantidades.length,
    validades.length,
  );

  const linhas: LinhaDeTerapia[] = [];

  for (let indice = 0; indice < total; indice += 1) {
    const validade = String(validades[indice] ?? "").trim();

    linhas.push({
      terapiaId: paraInteiro(String(terapias[indice] ?? "")),
      qtdAutorizada: paraInteiro(String(quantidades[indice] ?? "")),
      // Campo opcional: vazio é ausência de validade, não erro.
      validade: validade === "" ? null : validade,
    });
  }

  return linhas;
}

/**
 * Cria a requisição e, no sucesso, manda para o dashboard com o aviso.
 *
 * Sucesso -> `redirect` para `/dashboard?criada=...`, que o dashboard traduz em
 * um toast. Não há `revalidatePath` aqui: o dashboard é dinâmico (depende da
 * sessão), então o `redirect` já entrega a página recém-renderizada, com a
 * requisição nova dentro.
 *
 * Falha -> devolve a mensagem para o formulário, que continua na tela com o
 * que o usuário digitou.
 */
export async function criarRequisicaoAction(
  _prev: EstadoNovaRequisicao,
  formData: FormData,
): Promise<EstadoNovaRequisicao> {
  await requireUsuario();

  const entrada: EntradaNovaRequisicao = {
    pacienteNome: String(formData.get("pacienteNome") ?? ""),
    numeroRequisicao: String(formData.get("numeroRequisicao") ?? ""),
    linhas: lerLinhas(formData),
  };

  const resultado = await criarRequisicao(entrada);

  if (!resultado.ok) {
    return { erro: resultado.erro, linha: resultado.linha };
  }

  const parametros = new URLSearchParams({
    criada: resultado.numeroRequisicao,
    paciente: resultado.pacienteNome,
  });

  // `redirect` lança uma exceção de controle — precisa ficar fora de try/catch.
  redirect(`/dashboard?${parametros.toString()}`);
}

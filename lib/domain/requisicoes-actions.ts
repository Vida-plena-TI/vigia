"use server";

/**
 * Server Action do cadastro de nova requisição.
 *
 * Como toda action do projeto, é alcançável por um POST direto sem passar pela
 * UI — por isso a checagem (regra 4 do CONTEXT.md) vem antes de qualquer
 * leitura do formulário, e a validação de verdade mora em
 * `lib/domain/requisicoes.ts`, não no JavaScript da página.
 *
 * Desde a Fase C a checagem é `autorizarRota()`, não `requireUsuario()`: esta
 * tela é só do `admin`. O `proxy.ts` desvia a recepção da *navegação*, mas um
 * POST montado à mão não navega — quem recusa é esta linha, com o papel lido do
 * banco.
 *
 * As linhas de terapia viajam como campos repetidos (`terapiaId`,
 * `qtdAutorizada`, `validade`), um por linha renderizada. `getAll` devolve os
 * três vetores na ordem do DOM, e eles são costurados por índice.
 *
 * O sucesso tem **dois desfechos**, e o estado devolvido diz qual foi: a
 * requisição nasceu agora, ou as terapias entraram numa requisição que aquele
 * paciente já tinha com aquele número — como guias novas ou atualizando a guia
 * da terapia que ela já tinha. Quem decide é o domínio; aqui só se
 * repassa o que ele respondeu.
 */

import { refresh } from "next/cache";

import {
  MENSAGEM_SEM_PERMISSAO,
  ROTA_NOVA_REQUISICAO,
} from "@/lib/auth/acesso";
import { autorizarRota } from "@/lib/auth/current-user";

import {
  criarRequisicao,
  previsaoDeSubstituicao,
  type EntradaNovaRequisicao,
  type LinhaDeTerapia,
} from "./requisicoes";
import type { ItemDeSubstituicao } from "./requisicoes-mensagens";
import {
  planoParaRequisicao,
  type TerapiaDoPlanoParaRequisicao,
} from "./plano-terapias";

/** Valor do checkbox "Substituir guias da mesma terapia" quando marcado. */
const VALOR_SUBSTITUIR = "sim";

/** Estado que o formulário lê de volta via `useActionState`. */
export type EstadoNovaRequisicao = {
  erro?: string;
  /** Índice da linha de terapia culpada, quando o erro é de uma linha. */
  linha?: number;
  /** Presente só no sucesso. É ele que dispara a limpeza do formulário. */
  sucesso?: {
    pacienteNome: string;
    numeroRequisicao: string;
    /**
     * `false` quando o número submetido já era de uma requisição daquele
     * paciente e as terapias foram acrescentadas a ela.
     *
     * Viaja até o formulário porque é lá que a confirmação é montada, e as duas
     * confirmações são eventos diferentes — ver `mensagemDeCriacao`.
     */
    requisicaoCriada: boolean;
    /** Quantas guias novas este envio inseriu. */
    terapiasAdicionadas: number;
    /**
     * Quantas guias que a requisição já tinha este envio atualizou, por trazer
     * uma terapia que já estava nela.
     */
    terapiasAtualizadas: number;
    /** O que a substituição apagou de fato (vazio sem a caixinha). */
    substituidas: ItemDeSubstituicao[];
    /** Requisições antigas apagadas por terem ficado sem guia. */
    requisicoesApagadas: string[];
    /**
     * Identificador da criação, único por submissão.
     *
     * O formulário guarda o último token já tratado para não repetir a
     * limpeza no StrictMode nem confundir duas requisições iguais no shape.
     */
    token: string;
  };
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
  const total = Math.max(terapias.length, quantidades.length, validades.length);

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
 * Cria a requisição e, no sucesso, mantém o usuário na tela.
 *
 * Sucesso -> `refresh()` para redesenhar o Server Component e atualizar a
 * lista de pacientes do `datalist`, mais um estado com token único para o
 * formulário limpar os campos e avisar o usuário.
 *
 * Falha -> devolve a mensagem para o formulário, que continua na tela com o
 * que o usuário digitou.
 */
export async function criarRequisicaoAction(
  _prev: EstadoNovaRequisicao,
  formData: FormData,
): Promise<EstadoNovaRequisicao> {
  if (!(await autorizarRota(ROTA_NOVA_REQUISICAO))) {
    return { erro: MENSAGEM_SEM_PERMISSAO };
  }

  const entrada: EntradaNovaRequisicao = {
    pacienteNome: String(formData.get("pacienteNome") ?? ""),
    numeroRequisicao: String(formData.get("numeroRequisicao") ?? ""),
    linhas: lerLinhas(formData),
    // Só o valor exato liga a substituição: um campo ausente, vazio ou com
    // qualquer outro texto é o comportamento de sempre — o caminho que não
    // apaga nada.
    substituir: formData.get("substituir") === VALOR_SUBSTITUIR,
  };

  const resultado = await criarRequisicao(entrada);

  if (!resultado.ok) {
    return { erro: resultado.erro, linha: resultado.linha };
  }

  refresh();

  return {
    sucesso: {
      pacienteNome: resultado.pacienteNome,
      numeroRequisicao: resultado.numeroRequisicao,
      requisicaoCriada: resultado.requisicaoCriada,
      terapiasAdicionadas: resultado.terapiasAdicionadas,
      terapiasAtualizadas: resultado.terapiasAtualizadas,
      // Só os campos de texto; os ids ficam no servidor.
      substituidas: resultado.substituidas.map((guia) => ({
        terapiaNome: guia.terapiaNome,
        numeroRequisicao: guia.numeroRequisicao,
        atendimentos: guia.atendimentos,
      })),
      requisicoesApagadas: resultado.requisicoesApagadas,
      token: crypto.randomUUID(),
    },
  };
}

export type ResultadoDaPrevisao =
  { ok: true; itens: ItemDeSubstituicao[] } | { ok: false; erro: string };

/**
 * O que a caixinha "Substituir" apagaria, para o diálogo de confirmação.
 *
 * Leitura pura: não grava, não trava, não chama `refresh()`. Mesmo par de
 * `contarParaExcluirPaciente`: a prévia vem **antes** do diálogo, para a frase
 * citar o que o banco tem e não uma estimativa. Quem apaga é
 * `criarRequisicaoAction`, que refaz a consulta dentro da transação.
 *
 * Só admin, como a criação: ela lê as guias e os atendimentos de um paciente,
 * e esta tela não é da recepção. Os argumentos chegam de um POST que pode ter
 * sido montado à mão, então são conferidos aqui em vez de confiados ao tipo.
 */
export async function previsaoDeSubstituicaoAction(entrada: {
  pacienteNome: string;
  numeroRequisicao: string;
  terapiaIds: number[];
}): Promise<ResultadoDaPrevisao> {
  if (!(await autorizarRota(ROTA_NOVA_REQUISICAO))) {
    return { ok: false, erro: MENSAGEM_SEM_PERMISSAO };
  }

  const terapiaIds = Array.isArray(entrada?.terapiaIds)
    ? entrada.terapiaIds.filter(
        (id): id is number => typeof id === "number" && Number.isInteger(id),
      )
    : [];

  const guias = await previsaoDeSubstituicao(
    String(entrada?.pacienteNome ?? ""),
    terapiaIds,
    String(entrada?.numeroRequisicao ?? ""),
  );

  return {
    ok: true,
    itens: guias.map((guia) => ({
      terapiaNome: guia.terapiaNome,
      numeroRequisicao: guia.numeroRequisicao,
      atendimentos: guia.atendimentos,
    })),
  };
}

export type ResultadoDoPlanoParaRequisicao =
  | { ok: true; encontrado: false }
  | { ok: true; encontrado: true; terapias: TerapiaDoPlanoParaRequisicao[] }
  | { ok: false; erro: string };

/**
 * As terapias do plano do paciente digitado, para o formulário preencher as
 * linhas (regra 26). **Só leitura**: não grava, não cria paciente, não chama
 * `refresh()`.
 *
 * Só admin, como o resto da tela — `autorizarRota` passa por
 * `requireUsuario()` e decide pelo papel lido do banco. O nome chega de um POST
 * que pode ter sido montado à mão, então é conferido aqui em vez de confiado
 * ao tipo.
 *
 * A resposta é remontada campo a campo: só `terapiaId`, `nome` e
 * `minutosSemanais` saem daqui, mesmo que o domínio um dia devolva mais.
 */
export async function planoParaRequisicaoAction(
  pacienteNome: string,
): Promise<ResultadoDoPlanoParaRequisicao> {
  if (!(await autorizarRota(ROTA_NOVA_REQUISICAO))) {
    return { ok: false, erro: MENSAGEM_SEM_PERMISSAO };
  }

  const plano = await planoParaRequisicao(
    typeof pacienteNome === "string" ? pacienteNome : "",
  );

  if (!plano.encontrado) {
    return { ok: true, encontrado: false };
  }

  return {
    ok: true,
    encontrado: true,
    terapias: plano.terapias.map((terapia) => ({
      terapiaId: terapia.terapiaId,
      nome: terapia.nome,
      minutosSemanais: terapia.minutosSemanais,
    })),
  };
}

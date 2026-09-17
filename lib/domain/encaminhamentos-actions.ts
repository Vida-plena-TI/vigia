"use server";

/**
 * Server Action do cadastro de encaminhamento.
 *
 * Como toda action do projeto, é alcançável por um POST direto sem passar pela
 * UI — por isso a checagem (regra 4 do CONTEXT.md) vem antes de qualquer
 * leitura do formulário, e a validação de verdade mora em
 * `lib/domain/encaminhamentos.ts`, não no JavaScript da página.
 *
 * Desde a Fase C a checagem é `autorizarRota()`, não `requireUsuario()`: esta
 * tela é só do `admin`. Cadastrar e substituir são a mesma action (o upsert),
 * então a recusa cobre as duas de uma vez.
 *
 * Gravar aqui é **upsert**: um paciente tem no máximo um encaminhamento, e
 * cadastrar outro substitui o anterior. Por isso o estado de sucesso carrega
 * `substituiuAnterior` — o formulário precisa dizer "atualizado" ou
 * "cadastrado", que são eventos diferentes para quem digitou.
 *
 * Sucesso não navega: `refresh()` redesenha o Server Component da própria
 * página, e a listagem logo abaixo do formulário já volta com o registro novo —
 * e, no caso da substituição, sem a linha antiga. É o mesmo desenho de "Lançar
 * atendimento" — quem cadastra vários seguidos não deveria esperar uma
 * navegação entre um e outro.
 */

import { refresh } from "next/cache";

import {
  MENSAGEM_SEM_PERMISSAO,
  ROTA_ENCAMINHAMENTOS,
} from "@/lib/auth/acesso";
import { autorizarRota } from "@/lib/auth/current-user";

import {
  registrarEncaminhamento,
  type EntradaNovoEncaminhamento,
} from "./encaminhamentos";

/** Estado que o formulário lê de volta via `useActionState`. */
export type EstadoNovoEncaminhamento = {
  erro?: string;
  /** Presente só no sucesso. É ele que dispara a limpeza do formulário. */
  sucesso?: {
    pacienteNome: string;
    /** "AAAA-MM-DD". */
    dataEncaminhamento: string;
    /** "AAAA-MM-DD", vinda da coluna gerada pelo banco. */
    dataVencimento: string;
    /** `true` quando este encaminhamento substituiu um que já existia. */
    substituiuAnterior: boolean;
    /**
     * Identificador da gravação, único por submissão.
     *
     * O formulário guarda o último token já tratado para não repetir a limpeza
     * no StrictMode nem confundir dois cadastros idênticos no shape.
     */
    token: string;
  };
};

export async function criarEncaminhamentoAction(
  _prev: EstadoNovoEncaminhamento,
  formData: FormData,
): Promise<EstadoNovoEncaminhamento> {
  if (!(await autorizarRota(ROTA_ENCAMINHAMENTOS))) {
    return { erro: MENSAGEM_SEM_PERMISSAO };
  }

  const entrada: EntradaNovoEncaminhamento = {
    pacienteNome: String(formData.get("pacienteNome") ?? ""),
    dataEncaminhamento: String(formData.get("dataEncaminhamento") ?? ""),
  };

  const resultado = await registrarEncaminhamento(entrada);

  if (!resultado.ok) {
    return { erro: resultado.erro };
  }

  refresh();

  return {
    sucesso: {
      pacienteNome: resultado.pacienteNome,
      dataEncaminhamento: resultado.dataEncaminhamento,
      dataVencimento: resultado.dataVencimento,
      substituiuAnterior: resultado.substituiuAnterior,
      token: crypto.randomUUID(),
    },
  };
}

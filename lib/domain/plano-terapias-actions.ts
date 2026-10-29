"use server";

/**
 * Server Action do cadastro de paciente com plano de terapias.
 *
 * Ainda **sem tela** (29/10/2026): a action existe para o formulário que vem
 * depois, e já nasce com a checagem de papel. Como toda action, é alcançável
 * por POST direto: a autorização vem antes de chamar o domínio, e a validação
 * de verdade mora em `lib/domain/plano-terapias.ts`.
 *
 * O cadastro é de cada convênio, e cada convênio tem a sua aba de
 * encaminhamentos — hoje as duas só do `admin`. A rota que autoriza é a da aba
 * do convênio do envio; um convênio inválido cai na da Klini (também só de
 * admin) e é recusado pelo domínio em seguida.
 *
 * Linhas do plano viajam como campos repetidos (`terapiaId`, `horas`), lidos
 * com `getAll` e costurados por índice — mesmo desenho de "Nova requisição".
 * Nome e plano não voltam no estado de sucesso além do nome gravado.
 */

import { refresh } from "next/cache";

import {
  MENSAGEM_SEM_PERMISSAO,
  ROTA_ENCAMINHAMENTOS,
  ROTA_SULAMERICA_ENCAMINHAMENTOS,
} from "@/lib/auth/acesso";
import { autorizarRota } from "@/lib/auth/current-user";

import {
  cadastrarPaciente,
  type EntradaCadastroDePaciente,
} from "./plano-terapias";

/** Estado que o formulário lê de volta via `useActionState`. */
export type EstadoCadastroDePaciente = {
  erro?: string;
  /** Índice da linha do plano a que o erro se refere, quando é de uma. */
  linha?: number;
  sucesso?: {
    pacienteNome: string;
    pacienteCriado: boolean;
    /** Único por envio, para o formulário não repetir a limpeza. */
    token: string;
  };
};

export async function cadastrarPacienteAction(
  _prev: EstadoCadastroDePaciente,
  formData: FormData,
): Promise<EstadoCadastroDePaciente> {
  const convenio = String(formData.get("convenio") ?? "");
  const rota =
    convenio === "sulamerica"
      ? ROTA_SULAMERICA_ENCAMINHAMENTOS
      : ROTA_ENCAMINHAMENTOS;

  if (!(await autorizarRota(rota))) {
    return { erro: MENSAGEM_SEM_PERMISSAO };
  }

  const terapiaIds = formData.getAll("terapiaId").map(String);
  const horas = formData.getAll("horas").map(String);
  // O maior dos dois: uma linha incompleta (só num POST montado à mão) cai na
  // validação em vez de herdar o valor da vizinha.
  const total = Math.max(terapiaIds.length, horas.length);

  const entrada: EntradaCadastroDePaciente = {
    nome: String(formData.get("nome") ?? ""),
    convenio,
    terapias: Array.from({ length: total }, (_, indice) => ({
      terapiaId: /^\d+$/.test(terapiaIds[indice] ?? "")
        ? Number(terapiaIds[indice])
        : 0,
      horas: horas[indice] ?? "",
    })),
  };

  const resultado = await cadastrarPaciente(entrada);

  if (!resultado.ok) {
    return { erro: resultado.erro, linha: resultado.linha };
  }

  refresh();

  return {
    sucesso: {
      pacienteNome: resultado.pacienteNome,
      pacienteCriado: resultado.pacienteCriado,
      token: crypto.randomUUID(),
    },
  };
}

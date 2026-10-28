"use client";

import { useMemo } from "react";

import type { SituacaoDaCarteirinha } from "@/lib/domain/carteirinha-crm";
import type { PacienteParaEncaminhamento } from "@/lib/domain/pacientes";

/**
 * A situação da carteirinha deduzida do nome digitado — dica de tela para os
 * dois formulários de encaminhamento (Klini e SulAmérica). Quem decide de
 * verdade é a transação do servidor, que lê o paciente travado.
 *
 * Recebe por nome **só o booleano** "tem carteirinha", nunca o número.
 */
export function useSituacaoDaCarteirinha(
  pacientes: PacienteParaEncaminhamento[],
  pacienteNome: string,
): SituacaoDaCarteirinha {
  // Chave `toLowerCase()` para casar com o get-or-create, que compara por
  // `lower(nome)`. Pode discordar do Postgres em letra exótica; aí o pior caso
  // é a dica errada, e o servidor responde com a frase certa.
  const temCarteirinhaPorNome = useMemo(
    () =>
      new Map(
        pacientes.map((paciente) => [
          paciente.nome.toLowerCase(),
          paciente.temCarteirinha,
        ]),
      ),
    [pacientes],
  );
  const temCarteirinha = temCarteirinhaPorNome.get(
    pacienteNome.trim().toLowerCase(),
  );

  return temCarteirinha === undefined
    ? "paciente-novo"
    : temCarteirinha
      ? "com-carteirinha"
      : "sem-carteirinha";
}

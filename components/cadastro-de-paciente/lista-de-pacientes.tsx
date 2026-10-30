"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { normalizarParaBusca } from "@/app/(app)/klini/dashboard/formato";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Convenio } from "@/lib/domain/convenio";
import type { PacienteDoConvenio } from "@/lib/domain/plano-terapias";

import { ExcluirPaciente } from "./excluir-paciente";
import { SEM_PLANO, resumirPlano } from "./resumo-do-plano";

/**
 * Os pacientes do convênio da aba, em ordem de nome (vem pronta do banco), com
 * o plano em uma linha, o "Editar" e o "Excluir" (exclusão permanente do
 * paciente, com a confirmação digitada — ver `excluir-paciente.tsx`).
 *
 * A busca é a das listas de encaminhamento: client-side, com
 * `normalizarParaBusca` (sem acento nem caixa). Duas colunas de dado e uma de
 * ação: a tabela aparece a partir de `lg` e, abaixo disso, cada paciente vira
 * um bloco — a página nunca rola de lado.
 *
 * Só nome e plano: nenhuma carteirinha nem CRM chega a esta tela.
 */
export function ListaDePacientesDoConvenio({
  convenio,
  pacientes,
  aoEditar,
  aoExcluir,
}: {
  convenio: Convenio;
  pacientes: PacienteDoConvenio[];
  aoEditar: (paciente: PacienteDoConvenio) => void;
  aoExcluir: (paciente: PacienteDoConvenio) => void;
}) {
  const [busca, setBusca] = useState("");
  const termo = normalizarParaBusca(busca);

  const visiveis = useMemo(() => {
    if (!termo) {
      return pacientes;
    }

    return pacientes.filter((paciente) =>
      normalizarParaBusca(paciente.pacienteNome).includes(termo),
    );
  }, [pacientes, termo]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex w-full flex-col gap-1.5 sm:w-72">
          <Label htmlFor="busca-paciente" className="text-xs">
            Buscar paciente
          </Label>
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="busca-paciente"
              type="search"
              placeholder="Nome do paciente"
              autoComplete="off"
              value={busca}
              onChange={(evento) => setBusca(evento.target.value)}
              className="h-9 pl-8"
            />
          </div>
        </div>

        <p className="pb-2 text-xs text-muted-foreground" aria-live="polite">
          {termo
            ? `${visiveis.length} de ${pacientes.length} paciente(s)`
            : `${pacientes.length} paciente(s)`}
        </p>
      </div>

      {pacientes.length === 0 ? (
        <p className="folha px-4 py-8 text-center text-sm text-muted-foreground">
          Nenhum paciente cadastrado neste convênio ainda.
        </p>
      ) : null}

      {pacientes.length > 0 && visiveis.length === 0 ? (
        <p className="folha px-4 py-8 text-center text-sm text-muted-foreground">
          Nenhum paciente encontrado para &ldquo;{busca.trim()}&rdquo;.
        </p>
      ) : null}

      {visiveis.length > 0 ? (
        <div className="folha overflow-hidden">
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-regua-forte bg-secondary/60">
                  <th scope="col" className={CLASSE_CABECALHO}>
                    Paciente
                  </th>
                  <th scope="col" className={CLASSE_CABECALHO}>
                    Plano por semana
                  </th>
                  <th scope="col" className={`${CLASSE_CABECALHO} w-44 text-right`}>
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((paciente) => (
                  <tr
                    key={paciente.pacienteId}
                    className="border-b border-regua last:border-b-0 hover:bg-secondary/40"
                  >
                    <td className="px-3 py-2 font-medium">{paciente.pacienteNome}</td>
                    <td className="px-3 py-2">
                      <ResumoDoPlano paciente={paciente} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <AcoesDoPaciente
                        convenio={convenio}
                        paciente={paciente}
                        aoEditar={aoEditar}
                        aoExcluir={aoExcluir}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="divide-y divide-regua lg:hidden">
            {visiveis.map((paciente) => (
              <li key={paciente.pacienteId} className="flex flex-col gap-1 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 text-sm font-medium break-words">
                    {paciente.pacienteNome}
                  </p>
                  <AcoesDoPaciente
                    convenio={convenio}
                    paciente={paciente}
                    aoEditar={aoEditar}
                    aoExcluir={aoExcluir}
                  />
                </div>
                <p className="text-xs break-words">
                  <ResumoDoPlano paciente={paciente} />
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ResumoDoPlano({ paciente }: { paciente: PacienteDoConvenio }) {
  const resumo = resumirPlano(paciente.plano);

  return resumo === null ? (
    <span className="text-muted-foreground">{SEM_PLANO}</span>
  ) : (
    <span>{resumo}</span>
  );
}

function AcoesDoPaciente({
  convenio,
  paciente,
  aoEditar,
  aoExcluir,
}: {
  convenio: Convenio;
  paciente: PacienteDoConvenio;
  aoEditar: (paciente: PacienteDoConvenio) => void;
  aoExcluir: (paciente: PacienteDoConvenio) => void;
}) {
  return (
    <div className="inline-flex flex-wrap justify-end gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={`Editar o plano de ${paciente.pacienteNome}`}
        onClick={() => aoEditar(paciente)}
      >
        Editar
      </Button>
      <ExcluirPaciente
        pacienteId={paciente.pacienteId}
        pacienteNome={paciente.pacienteNome}
        convenio={convenio}
        aoExcluir={() => aoExcluir(paciente)}
      />
    </div>
  );
}

/** Mesmo cabeçalho de coluna das outras listas. */
const CLASSE_CABECALHO =
  "px-3 py-1.5 text-left text-2xs font-medium whitespace-nowrap text-muted-foreground";

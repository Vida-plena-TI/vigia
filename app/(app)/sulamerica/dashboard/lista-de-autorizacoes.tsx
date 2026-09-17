"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { AutorizacaoNaLista } from "@/lib/domain/autorizacoes-sulamerica";

import { formatarData, normalizarParaBusca } from "../../klini/dashboard/formato";
import { ExcluirAutorizacao } from "./excluir-autorizacao";
import {
  MARCADOR_POR_VENCIMENTO,
  MARCADOR_SEM_VENCIMENTO,
  SeloDeVencimento,
} from "../../klini/encaminhamentos/selo-de-vencimento";

export function ListaDeAutorizacoes({
  autorizacoes,
}: {
  autorizacoes: AutorizacaoNaLista[];
}) {
  const [busca, setBusca] = useState("");

  const termo = normalizarParaBusca(busca);

  const visiveis = useMemo(() => {
    if (!termo) {
      return autorizacoes;
    }

    return autorizacoes.filter((autorizacao) =>
      normalizarParaBusca(autorizacao.pacienteNome).includes(termo),
    );
  }, [autorizacoes, termo]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex w-full flex-col gap-1.5 sm:w-72">
          <Label htmlFor="busca-autorizacao" className="text-xs">
            Buscar paciente
          </Label>
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="busca-autorizacao"
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
            ? `${visiveis.length} de ${autorizacoes.length} autorização(ões)`
            : `${autorizacoes.length} autorização(ões)`}
        </p>
      </div>

      {autorizacoes.length === 0 ? (
        <p className="folha px-4 py-8 text-center text-sm text-muted-foreground">
          Nenhuma autorização registrada ainda.
        </p>
      ) : null}

      {autorizacoes.length > 0 && visiveis.length === 0 ? (
        <p className="folha px-4 py-8 text-center text-sm text-muted-foreground">
          Nenhum paciente encontrado para &ldquo;{busca.trim()}&rdquo;.
        </p>
      ) : null}

      {visiveis.length > 0 ? (
        <div className="folha overflow-hidden">
          <table className="hidden w-full border-collapse text-sm sm:table">
            <thead>
              <tr className="border-b border-regua-forte bg-secondary/60">
                <th scope="col" className={CLASSE_CABECALHO}>
                  Paciente
                </th>
                <th scope="col" className={`${CLASSE_CABECALHO} w-48`}>
                  Data de início
                </th>
                <th scope="col" className={CLASSE_CABECALHO}>Prazo</th>
                <th scope="col" className={`${CLASSE_CABECALHO} w-40`}>
                  Vencimento
                </th>
                <th scope="col" className={`${CLASSE_CABECALHO} w-44`}>
                  Situação
                </th>
                <th scope="col" className={`${CLASSE_CABECALHO} w-28 text-right`}>
                  Ações
                </th>
              </tr>
            </thead>

            <tbody>
              {visiveis.map((autorizacao) => (
                <tr
                  key={autorizacao.id}
                  className={cn(
                    "border-b border-l-[3px] border-regua last:border-b-0 hover:bg-secondary/40",
                    autorizacao.statusAutorizacao === null
                      ? MARCADOR_SEM_VENCIMENTO
                      : MARCADOR_POR_VENCIMENTO[
                          autorizacao.statusAutorizacao
                        ],
                  )}
                >
                  <td className="px-3 py-2 font-medium">
                    {autorizacao.pacienteNome}
                  </td>
                  <td className="px-3 py-2">
                    {formatarData(autorizacao.dataInicio)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {autorizacao.prazoMeses} meses
                  </td>
                  <td className="px-3 py-2">
                    {formatarData(autorizacao.dataVencimento)}
                  </td>
                  <td className="px-3 py-2">
                    <SeloDeVencimento
                      status={autorizacao.statusAutorizacao}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <ExcluirAutorizacao
                      id={autorizacao.id}
                      pacienteNome={autorizacao.pacienteNome}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <ul className="divide-y divide-regua sm:hidden">
            {visiveis.map((autorizacao) => (
              <li
                key={autorizacao.id}
                className={cn(
                  "flex flex-col gap-1 border-l-[3px] px-4 py-3",
                  autorizacao.statusAutorizacao === null
                    ? MARCADOR_SEM_VENCIMENTO
                    : MARCADOR_POR_VENCIMENTO[
                        autorizacao.statusAutorizacao
                      ],
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    {autorizacao.pacienteNome}
                  </p>
                  <SeloDeVencimento
                    status={autorizacao.statusAutorizacao}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Início em{" "}
                  {formatarData(autorizacao.dataInicio)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Prazo: {autorizacao.prazoMeses} meses · Vence em {formatarData(autorizacao.dataVencimento)}
                </p>
                <div className="mt-1 flex justify-end">
                  <ExcluirAutorizacao
                    id={autorizacao.id}
                    pacienteNome={autorizacao.pacienteNome}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

const CLASSE_CABECALHO =
  "px-3 py-1.5 text-left text-2xs font-medium text-muted-foreground";

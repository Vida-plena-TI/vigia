"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { EncaminhamentoNaLista } from "@/lib/domain/encaminhamentos";

import { formatarData, normalizarParaBusca } from "../dashboard/formato";
import {
  MARCADOR_POR_VENCIMENTO,
  MARCADOR_SEM_VENCIMENTO,
  SeloDeVencimento,
} from "./selo-de-vencimento";

/**
 * A listagem de encaminhamentos, com filtro por nome de paciente.
 *
 * O filtro é o mesmo do painel, inclusive na normalização (`normalizarParaBusca`
 * tira acento e caixa, para "Joao" achar "João") e no comportamento: é
 * client-side, porque a lista inteira já veio renderizada do servidor e filtrar
 * em memória evita um ida-e-volta por tecla digitada. Se um dia a lista crescer
 * a ponto de pesar, aí sim vira `searchParams` + consulta no banco — nos dois
 * lugares ao mesmo tempo.
 *
 * Não há estado de seleção nem de recolhimento aqui: cada paciente tem no
 * máximo um encaminhamento, então a lista é plana e cada linha é um paciente.
 * É a mesma regra de unicidade do banco aparecendo na forma da tela.
 */
export function ListaDeEncaminhamentos({
  encaminhamentos,
}: {
  encaminhamentos: EncaminhamentoNaLista[];
}) {
  const [busca, setBusca] = useState("");

  const termo = normalizarParaBusca(busca);

  const visiveis = useMemo(() => {
    if (!termo) {
      return encaminhamentos;
    }

    return encaminhamentos.filter((encaminhamento) =>
      normalizarParaBusca(encaminhamento.pacienteNome).includes(termo),
    );
  }, [encaminhamentos, termo]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex w-full flex-col gap-1.5 sm:w-72">
          <Label htmlFor="busca-encaminhamento" className="text-xs">
            Buscar paciente
          </Label>
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="busca-encaminhamento"
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
            ? `${visiveis.length} de ${encaminhamentos.length} encaminhamento(s)`
            : `${encaminhamentos.length} encaminhamento(s)`}
        </p>
      </div>

      {encaminhamentos.length === 0 ? (
        <p className="folha px-4 py-8 text-center text-sm text-muted-foreground">
          Nenhum encaminhamento registrado ainda.
        </p>
      ) : null}

      {encaminhamentos.length > 0 && visiveis.length === 0 ? (
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
                  Data do encaminhamento
                </th>
                <th scope="col" className={`${CLASSE_CABECALHO} w-40`}>
                  Vencimento
                </th>
                <th scope="col" className={`${CLASSE_CABECALHO} w-44`}>
                  Situação
                </th>
              </tr>
            </thead>

            <tbody>
              {visiveis.map((encaminhamento) => (
                <tr
                  key={encaminhamento.id}
                  className={cn(
                    // Filete de margem de 3px, o mesmo canal do painel: dá para
                    // varrer só a borda esquerda e saber onde olhar.
                    "border-b border-l-[3px] border-regua last:border-b-0 hover:bg-secondary/40",
                    encaminhamento.statusEncaminhamento === null
                      ? MARCADOR_SEM_VENCIMENTO
                      : MARCADOR_POR_VENCIMENTO[
                          encaminhamento.statusEncaminhamento
                        ],
                  )}
                >
                  <td className="px-3 py-2 font-medium">
                    {encaminhamento.pacienteNome}
                  </td>
                  <td className="px-3 py-2">
                    {formatarData(encaminhamento.dataEncaminhamento)}
                  </td>
                  <td className="px-3 py-2">
                    {formatarData(encaminhamento.dataVencimento)}
                  </td>
                  <td className="px-3 py-2">
                    <SeloDeVencimento
                      status={encaminhamento.statusEncaminhamento}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Abaixo de `sm` as colunas viram blocos, como no painel. */}
          <ul className="divide-y divide-regua sm:hidden">
            {visiveis.map((encaminhamento) => (
              <li
                key={encaminhamento.id}
                className={cn(
                  "flex flex-col gap-1 border-l-[3px] px-4 py-3",
                  encaminhamento.statusEncaminhamento === null
                    ? MARCADOR_SEM_VENCIMENTO
                    : MARCADOR_POR_VENCIMENTO[
                        encaminhamento.statusEncaminhamento
                      ],
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    {encaminhamento.pacienteNome}
                  </p>
                  <SeloDeVencimento
                    status={encaminhamento.statusEncaminhamento}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Encaminhado em{" "}
                  {formatarData(encaminhamento.dataEncaminhamento)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Vence em {formatarData(encaminhamento.dataVencimento)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Mesmo cabeçalho de coluna do painel: peso 500, cinza, caixa normal. */
const CLASSE_CABECALHO =
  "px-3 py-1.5 text-left text-2xs font-medium text-muted-foreground";

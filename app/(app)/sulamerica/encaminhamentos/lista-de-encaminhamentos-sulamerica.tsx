"use client";

import { useMemo, useState } from "react";
import { Info, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { EncaminhamentoSulamericaNaLista } from "@/lib/domain/autorizacoes-sulamerica";

import { formatarData, normalizarParaBusca } from "../../klini/dashboard/formato";
import {
  MARCADOR_POR_VENCIMENTO,
  MARCADOR_SEM_VENCIMENTO,
  SeloDeVencimento,
} from "../../klini/encaminhamentos/selo-de-vencimento";
import { ValorCopiavel } from "../../klini/encaminhamentos/valor-copiavel";

/**
 * Lista da aba Encaminhamentos da SulAmérica: as colunas do painel (início,
 * prazo, vencimento do banco, situação da view) mais carteirinha e CRM — com
 * botão de copiar, como na Klini (`ValorCopiavel`) — e o médico, só em texto.
 *
 * Legado (antes de 28/10/2026) tem os três nulos: "— falta preencher" por
 * escrito, cada campo por si. Com oito colunas a tabela só aparece a partir
 * de `lg`, com rolagem lateral própria por garantia; abaixo disso, blocos.
 * A ordem vem do banco; aqui só se filtra.
 */
export function ListaDeEncaminhamentosSulamerica({
  encaminhamentos,
}: {
  encaminhamentos: EncaminhamentoSulamericaNaLista[];
}) {
  const [busca, setBusca] = useState("");
  const termo = normalizarParaBusca(busca);

  // Sobre a lista inteira, não o filtro, como na Klini.
  const algumFaltaPreencher = encaminhamentos.some(
    ({ numeroCarteirinha, crmMedico, nomeMedico }) =>
      !numeroCarteirinha?.trim() || !crmMedico?.trim() || !nomeMedico?.trim(),
  );

  const visiveis = useMemo(() => {
    if (!termo) {
      return encaminhamentos;
    }
    return encaminhamentos.filter((linha) =>
      normalizarParaBusca(linha.pacienteNome).includes(termo),
    );
  }, [encaminhamentos, termo]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex w-full flex-col gap-1.5 sm:w-72">
          <Label htmlFor="busca-encaminhamento-sulamerica" className="text-xs">
            Buscar paciente
          </Label>
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="busca-encaminhamento-sulamerica"
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

      {algumFaltaPreencher ? (
        <p
          id="dica-falta-preencher"
          className="flex max-w-prose items-start gap-1.5 text-xs text-muted-foreground"
        >
          <Info aria-hidden className="mt-px size-3.5 shrink-0" />
          <span>
            &ldquo;Falta preencher&rdquo; aparece em quem foi cadastrado antes
            da carteirinha, do CRM e do nome do médico. Para completar, cadastre
            de novo com o mesmo nome e a mesma data e prazo exibidos — data ou
            prazo diferente substitui a autorização e muda o vencimento. Nesse
            reenvio o CRM e o nome do médico são exigidos, e a carteirinha
            também, se o paciente ainda não tiver uma.
          </span>
        </p>
      ) : null}

      {visiveis.length > 0 ? (
        <div className="folha overflow-hidden">
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-regua-forte bg-secondary/60">
                  {[
                    "Paciente",
                    "Data do encaminhamento",
                    "Prazo",
                    "Vencimento",
                    "Situação",
                    "Carteirinha",
                    "CRM",
                    "Médico",
                  ].map((coluna) => (
                    <th key={coluna} scope="col" className={CLASSE_CABECALHO}>
                      {coluna}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {visiveis.map((linha) => (
                  <tr
                    key={linha.id}
                    className={cn(
                      "border-b border-l-[3px] border-regua last:border-b-0 hover:bg-secondary/40",
                      linha.statusAutorizacao === null
                        ? MARCADOR_SEM_VENCIMENTO
                        : MARCADOR_POR_VENCIMENTO[linha.statusAutorizacao],
                    )}
                  >
                    <td className="px-3 py-2 font-medium">{linha.pacienteNome}</td>
                    <td className="px-3 py-2">{formatarData(linha.dataInicio)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{linha.prazoMeses} meses</td>
                    <td className="px-3 py-2">{formatarData(linha.dataVencimento)}</td>
                    <td className="px-3 py-2">
                      <SeloDeVencimento status={linha.statusAutorizacao} />
                    </td>
                    <td className="px-3 py-2">
                      <ValorCopiavel
                        campo="carteirinha"
                        valor={linha.numeroCarteirinha}
                        pacienteNome={linha.pacienteNome}
                        forma="tabela"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <ValorCopiavel
                        campo="crm"
                        valor={linha.crmMedico}
                        pacienteNome={linha.pacienteNome}
                        forma="tabela"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <NomeDoMedico nome={linha.nomeMedico} forma="tabela" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="divide-y divide-regua lg:hidden">
            {visiveis.map((linha) => (
              <li
                key={linha.id}
                className={cn(
                  "flex flex-col gap-1 border-l-[3px] px-4 py-3",
                  linha.statusAutorizacao === null
                    ? MARCADOR_SEM_VENCIMENTO
                    : MARCADOR_POR_VENCIMENTO[linha.statusAutorizacao],
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{linha.pacienteNome}</p>
                  <SeloDeVencimento status={linha.statusAutorizacao} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Encaminhado em {formatarData(linha.dataInicio)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Prazo: {linha.prazoMeses} meses · Vence em {formatarData(linha.dataVencimento)}
                </p>
                <div className="mt-1 flex flex-col gap-2">
                  <ValorCopiavel
                    campo="carteirinha"
                    valor={linha.numeroCarteirinha}
                    pacienteNome={linha.pacienteNome}
                    forma="bloco"
                  />
                  <ValorCopiavel
                    campo="crm"
                    valor={linha.crmMedico}
                    pacienteNome={linha.pacienteNome}
                    forma="bloco"
                  />
                  <NomeDoMedico nome={linha.nomeMedico} forma="bloco" />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Só texto, sem botão de copiar. Nulo no legado: "— falta preencher". */
function NomeDoMedico({ nome, forma }: { nome: string | null; forma: "tabela" | "bloco" }) {
  const texto = nome?.trim() ?? "";

  return (
    <span className="min-w-0 text-sm">
      {forma === "bloco" ? (
        <span className="text-xs text-muted-foreground">Médico: </span>
      ) : null}
      {texto ? (
        <span className="break-words">{texto}</span>
      ) : (
        <span className="text-muted-foreground">
          <span aria-hidden>— </span>
          falta preencher
        </span>
      )}
    </span>
  );
}

const CLASSE_CABECALHO =
  "px-3 py-1.5 text-left text-2xs font-medium whitespace-nowrap text-muted-foreground";

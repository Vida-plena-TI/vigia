"use client";

import { useMemo, useState } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PacienteComGuias } from "@/lib/domain/guias";

import { AcoesDaGuia } from "./acoes-da-guia";
import { formatarData, normalizarParaBusca } from "./formato";
import { StatusBadge } from "./status-badge";

/**
 * Lista de guias agrupada por paciente, com filtro por nome.
 *
 * O filtro é client-side: a lista inteira já veio renderizada do servidor, e
 * filtrar em memória evita um ida-e-volta por tecla digitada. Para o volume de
 * uma clínica isso é de longe o mais simples que funciona — se a lista crescer
 * a ponto de pesar, aí sim o filtro vira `searchParams` + consulta no banco.
 */
export function ListaDeGuias({
  pacientes,
}: {
  pacientes: PacienteComGuias[];
}) {
  const [busca, setBusca] = useState("");

  const termo = normalizarParaBusca(busca);

  const visiveis = useMemo(() => {
    if (!termo) {
      return pacientes;
    }

    return pacientes.filter((paciente) =>
      normalizarParaBusca(paciente.nome).includes(termo),
    );
  }, [pacientes, termo]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:max-w-sm">
        <Label htmlFor="busca-paciente">Buscar paciente</Label>
        <Input
          id="busca-paciente"
          type="search"
          placeholder="Nome do paciente"
          autoComplete="off"
          value={busca}
          onChange={(evento) => setBusca(evento.target.value)}
        />
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {termo
            ? `${visiveis.length} de ${pacientes.length} paciente(s)`
            : `${pacientes.length} paciente(s)`}
        </p>
      </div>

      {pacientes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma guia cadastrada ainda.
        </p>
      ) : null}

      {pacientes.length > 0 && visiveis.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum paciente encontrado para &ldquo;{busca.trim()}&rdquo;.
        </p>
      ) : null}

      {visiveis.map((paciente) => (
        <Card key={paciente.id}>
          <CardHeader>
            <CardTitle>{paciente.nome}</CardTitle>
            <CardDescription>
              {paciente.guias.length} guia(s)
            </CardDescription>
          </CardHeader>

          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Terapia</TableHead>
                  <TableHead>Requisição</TableHead>
                  <TableHead className="text-right">Autorizada</TableHead>
                  <TableHead className="text-right">Utilizada</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead>Validade</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {paciente.guias.map((guia) => (
                  <TableRow key={guia.id}>
                    <TableCell className="font-medium">
                      {guia.terapiaNome}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {guia.codigoTiss}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {guia.numeroRequisicao}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {guia.qtdAutorizada}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {guia.qtdUtilizada}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {guia.saldoRestante}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatarData(guia.validade)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={guia.statusAlerta} />
                    </TableCell>
                    <TableCell>
                      <AcoesDaGuia guia={guia} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

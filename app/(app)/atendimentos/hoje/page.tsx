import type { Metadata } from "next";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  dataDeHoje,
  listarAtendimentosDeHoje,
} from "@/lib/domain/atendimentos";

import { formatarData } from "../../dashboard/formato";

export const metadata: Metadata = {
  title: "Atendimentos de hoje | VIGIA",
};

/**
 * Lista simples dos atendimentos lançados hoje.
 *
 * A autenticação é garantida pelo layout `app/(app)/layout.tsx`
 * (`requireUsuario`), além da triagem do `proxy.ts`. A data de referência vem
 * do Postgres (`CURRENT_DATE`), não do relógio do navegador.
 */
export default async function AtendimentosDeHojePage() {
  const [atendimentos, hoje] = await Promise.all([
    listarAtendimentosDeHoje(),
    dataDeHoje(),
  ]);

  return (
    <div className="flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Atendimentos de hoje
        </h1>
        <p className="text-sm text-muted-foreground">
          {formatarData(hoje)} · {atendimentos.length} atendimento(s)
          lançado(s).
        </p>
      </div>

      {atendimentos.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum atendimento lançado hoje.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Paciente</TableHead>
              <TableHead>Terapia</TableHead>
              <TableHead className="w-28 text-right">Créditos</TableHead>
              <TableHead>Observação</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {atendimentos.map((atendimento) => (
              <TableRow key={atendimento.id}>
                <TableCell className="font-medium">
                  {atendimento.pacienteNome}
                </TableCell>
                <TableCell>{atendimento.terapiaNome}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {atendimento.creditosConsumidos}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {atendimento.observacao ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

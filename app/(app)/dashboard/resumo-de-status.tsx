import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ResumoPorStatus } from "@/lib/domain/guias";

import { CLASSE_POR_STATUS, STATUS_EM_ORDEM_DE_URGENCIA } from "./formato";

/** Legenda de cada status, para quem abre o sistema sem conhecer a regra. */
const LEGENDA = {
  Esgotada: "Sem autorização ou saldo zerado/negativo.",
  Renovar: "Saldo em 25% ou menos, ou validade em até 7 dias.",
  Regular: "Com saldo e sem validade próxima.",
} as const;

/**
 * Contagem total de guias por status.
 *
 * Reflete o sistema inteiro, não o filtro de busca: é o painel de alerta da
 * clínica, e ele não deveria mudar quando alguém digita um nome no filtro.
 */
export function ResumoDeStatus({ resumo }: { resumo: ResumoPorStatus }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {STATUS_EM_ORDEM_DE_URGENCIA.map((status) => (
        <Card key={status} size="sm">
          <CardContent className="flex flex-col gap-1">
            <span
              className={cn(
                "text-xs font-medium uppercase tracking-wide",
                CLASSE_POR_STATUS[status],
                "border-0 bg-transparent p-0",
              )}
            >
              {status}
            </span>
            <span className="text-2xl font-semibold tabular-nums">
              {resumo[status]}
            </span>
            <span className="text-xs text-muted-foreground">
              {LEGENDA[status]}
            </span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

import { cn } from "@/lib/utils";
import type { StatusAlerta } from "@/lib/domain/saldo";
import type { ResumoPorStatus } from "@/lib/domain/guias";

import { STATUS_EM_ORDEM_DE_URGENCIA, TINTA_POR_STATUS } from "./formato";
import { StatusIcone } from "./status-badge";

/** Legenda de cada status, para quem abre o sistema sem conhecer a regra. */
const LEGENDA = {
  Esgotada: "Sem autorização ou saldo zerado/negativo.",
  Renovar: "Saldo em 25% ou menos, ou validade em até 7 dias.",
  Regular: "Com saldo e sem validade próxima.",
} as const;

/** Filete de topo: identifica a coluna antes de o olho chegar no número. */
const TOPO_POR_STATUS: Record<StatusAlerta, string> = {
  Regular: "border-t-regular",
  Renovar: "border-t-renovar",
  Esgotada: "border-t-esgotada",
};

/**
 * Contagem total de guias por status — a leitura de ponteiro do instrumento.
 *
 * É uma folha só, dividida por filete, e não três cartões soltos: os três
 * números só significam alguma coisa comparados entre si, e cartões separados
 * sugeririam que cada um é um objeto independente.
 *
 * Reflete o sistema inteiro, não o filtro de busca: é o painel de alerta da
 * clínica, e ele não deveria mudar quando alguém digita um nome no filtro.
 */
export function ResumoDeStatus({ resumo }: { resumo: ResumoPorStatus }) {
  return (
    <section aria-label="Resumo de guias por status" className="folha overflow-hidden">
      <div className="grid divide-y divide-regua sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {STATUS_EM_ORDEM_DE_URGENCIA.map((status) => {
          const total = resumo[status];

          return (
            <div
              key={status}
              className={cn(
                "flex flex-col gap-1 border-t-[3px] px-4 py-3",
                TOPO_POR_STATUS[status],
              )}
            >
              <div
                className={cn(
                  "flex items-center gap-1.5 text-sm font-medium",
                  TINTA_POR_STATUS[status],
                )}
              >
                <StatusIcone status={status} />
                {status}
              </div>

              {/*
                Serifada aqui e no logotipo, em nenhum outro lugar: estes três
                números são a leitura do instrumento, não mais um dado de
                tabela. Abaixo de 1,75rem a serifada não entra.
              */}
              <span
                className={cn(
                  "font-serif text-4xl font-semibold",
                  total === 0 ? "text-muted-foreground" : TINTA_POR_STATUS[status],
                )}
              >
                {total}
              </span>

              <span className="text-xs text-muted-foreground">
                {LEGENDA[status]}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

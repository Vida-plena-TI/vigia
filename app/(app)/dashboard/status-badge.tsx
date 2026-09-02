import { Check, OctagonAlert, TriangleAlert, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { StatusAlerta } from "@/lib/domain/saldo";

/**
 * Selo do `status_alerta` — a informação mais importante do painel.
 *
 * Confundir "Esgotada" com "Regular" tem consequência no atendimento, então o
 * status não é comunicado só por cor. São cinco canais redundantes:
 *
 * 1. **Cor** — teal / âmbar / carmim. O eixo verde-vermelho puro foi evitado
 *    de propósito: "Regular" é teal, puxado para o lado azul do espectro, onde
 *    sobrevive a protanopia e deuteranopia.
 * 2. **Preenchimento** — "Esgotada" é bloco sólido com texto branco,
 *    "Renovar" é fundo tênue com anel, "Regular" é só contorno. Em escala de
 *    cinza os três continuam distintos.
 * 3. **Ícone** — silhuetas diferentes (check, triângulo, octógono), legíveis
 *    até fora de foco.
 * 4. **Peso da fonte** — 700 no "Esgotada", 500 nos outros dois.
 * 5. **Marcador de margem** na linha da tabela (ver `MARCADOR_POR_STATUS`).
 *
 * Contraste medido sobre a própria base: teal 5,3:1, âmbar 5,5:1, branco
 * sobre carmim 7,4:1 — AA em texto normal, não só em texto grande.
 */
const APRESENTACAO: Record<
  StatusAlerta,
  { icone: LucideIcon; classe: string }
> = {
  Regular: {
    icone: Check,
    classe: "bg-card text-regular ring-1 ring-regular/35 font-medium",
  },
  Renovar: {
    icone: TriangleAlert,
    classe: "bg-renovar-fundo text-renovar ring-1 ring-renovar/40 font-medium",
  },
  Esgotada: {
    icone: OctagonAlert,
    classe: "bg-esgotada text-white ring-1 ring-esgotada font-bold",
  },
};

export function StatusBadge({
  status,
  className,
}: {
  status: StatusAlerta;
  className?: string;
}) {
  const { icone: Icone, classe } = APRESENTACAO[status];

  return (
    <span
      data-status={status}
      className={cn(
        // Retângulo, não pílula: uma pílula lê como etiqueta decorativa; um
        // retângulo de canto curto lê como carimbo de prontuário.
        "inline-flex shrink-0 items-center gap-1 rounded-[3px] px-1.5 py-0.5 text-2xs whitespace-nowrap",
        classe,
        className,
      )}
    >
      <Icone aria-hidden className="size-3 shrink-0" strokeWidth={2.5} />
      {status}
    </span>
  );
}

/** O ícone sozinho, para onde o rótulo já aparece por escrito ao lado. */
export function StatusIcone({
  status,
  className,
}: {
  status: StatusAlerta;
  className?: string;
}) {
  const { icone: Icone } = APRESENTACAO[status];

  return <Icone aria-hidden className={cn("size-3.5", className)} strokeWidth={2.5} />;
}

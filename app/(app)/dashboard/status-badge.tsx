import { Check, OctagonAlert, TriangleAlert } from "lucide-react";

import {
  IconeDeStatus,
  SeloDeStatus,
  type ApresentacaoDeSelo,
} from "@/components/selo-de-status";
import type { StatusAlerta } from "@/lib/domain/saldo";

/**
 * Selo do `status_alerta` — a informação mais importante do painel.
 *
 * A geometria do selo (retângulo de canto curto, `text-2xs`, ícone de 12px)
 * mora em `components/selo-de-status.tsx` desde que a tela de encaminhamentos
 * passou a precisar da mesma forma com outro vocabulário. Aqui fica só o
 * vocabulário do painel: os três rótulos do `status_alerta` e a apresentação de
 * cada um.
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
export const APRESENTACAO: Record<StatusAlerta, ApresentacaoDeSelo> = {
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
  return (
    <SeloDeStatus
      rotulo={status}
      apresentacao={APRESENTACAO[status]}
      className={className}
    />
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
  return (
    <IconeDeStatus apresentacao={APRESENTACAO[status]} className={className} />
  );
}

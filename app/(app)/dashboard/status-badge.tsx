import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { StatusAlerta } from "@/lib/domain/saldo";

import { CLASSE_POR_STATUS } from "./formato";

/**
 * Selo colorido do `status_alerta`.
 *
 * A cor é redundante com o texto de propósito: o rótulo continua legível para
 * quem não distingue as cores.
 */
export function StatusBadge({
  status,
  className,
}: {
  status: StatusAlerta;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(CLASSE_POR_STATUS[status], className)}
    >
      {status}
    </Badge>
  );
}

import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A forma do selo de status do sistema — sem saber de qual status se trata.
 *
 * Este arquivo nasceu de `app/(app)/klini/dashboard/status-badge.tsx`, onde o
 * selo morava enquanto tinha um consumidor só (o `status_alerta` da guia). Com a
 * tela de encaminhamentos precisando de um selo com o **mesmo peso visual e
 * outro vocabulário**, ele subiu para cá em vez de ser copiado — mesma decisão,
 * e pelo mesmo motivo, do get-or-create que subiu para `lib/domain/pacientes.ts`
 * ao ganhar o segundo consumidor: duas cópias divergiriam, e é justamente a
 * geometria (retângulo de canto curto, gap, tamanho de ícone, `text-2xs`) que
 * precisa ser idêntica para os dois lerem como o mesmo instrumento.
 *
 * O que **não** mora aqui é o vocabulário: rótulo, cor e ícone chegam de fora,
 * num {@link ApresentacaoDeSelo}. É o que permite ao painel dizer
 * "Regular/Renovar/Esgotada" e à tela de encaminhamentos dizer "Vencido/Vence
 * este mês/A vencer" sem que um empreste ao outro uma palavra que significa
 * outra coisa.
 *
 * A redundância de canais que o sistema exige continua sendo responsabilidade
 * de quem define a apresentação — cor **e** preenchimento **e** ícone **e**
 * peso da fonte, para o status sobreviver à escala de cinza e à daltonia. Ver
 * `APRESENTACAO` em `status-badge.tsx` e `selo-de-vencimento.tsx`.
 */
export type ApresentacaoDeSelo = {
  icone: LucideIcon;
  /** Cor, preenchimento, anel e peso da fonte — os quatro juntos. */
  classe: string;
};

export function SeloDeStatus({
  rotulo,
  apresentacao,
  className,
}: {
  rotulo: string;
  apresentacao: ApresentacaoDeSelo;
  className?: string;
}) {
  const { icone: Icone, classe } = apresentacao;

  return (
    <span
      data-status={rotulo}
      className={cn(
        // Retângulo, não pílula: uma pílula lê como etiqueta decorativa; um
        // retângulo de canto curto lê como carimbo de prontuário.
        "inline-flex shrink-0 items-center gap-1 rounded-[3px] px-1.5 py-0.5 text-2xs whitespace-nowrap",
        classe,
        className,
      )}
    >
      <Icone aria-hidden className="size-3 shrink-0" strokeWidth={2.5} />
      {rotulo}
    </span>
  );
}

/** O ícone sozinho, para onde o rótulo já aparece por escrito ao lado. */
export function IconeDeStatus({
  apresentacao,
  className,
}: {
  apresentacao: ApresentacaoDeSelo;
  className?: string;
}) {
  const { icone: Icone } = apresentacao;

  return (
    <Icone aria-hidden className={cn("size-3.5", className)} strokeWidth={2.5} />
  );
}

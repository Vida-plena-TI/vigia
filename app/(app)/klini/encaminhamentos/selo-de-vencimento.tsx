import { CalendarClock, OctagonAlert, TriangleAlert } from "lucide-react";

import {
  IconeDeStatus,
  SeloDeStatus,
  type ApresentacaoDeSelo,
} from "@/components/selo-de-status";
import type { StatusEncaminhamento } from "@/lib/domain/encaminhamentos";

/**
 * O vocabulário de status **desta** tela.
 *
 * A forma do selo é a mesma do painel (`components/selo-de-status.tsx`); o que
 * muda são os três rótulos. O `StatusBadge` do painel foi deliberadamente
 * **não** reaproveitado: ele escreve "Regular" / "Renovar" / "Esgotada", e
 * nenhuma dessas três palavras diz o que se quer dizer sobre um encaminhamento
 * — usá-las aqui gastaria um vocabulário que significa outra coisa em todas as
 * outras telas. O que se reaproveita é a geometria, não as palavras.
 *
 * Os mesmos canais redundantes do painel, com o mesmo peso visual:
 *
 * 1. **Cor** — carmim para o vencido (a mesma tinta do "Esgotada", o status
 *    crítico do sistema), âmbar para os dois que ainda dá tempo de resolver.
 *    Nenhuma cor saturada nova entrou no sistema: continuam sendo as três de
 *    sempre, e aqui só duas delas aparecem.
 * 2. **Preenchimento** — é ele que separa a urgência **dentro** do âmbar, em
 *    vez de uma quarta cor: "Vence este mês" é fundo preenchido com anel,
 *    "A vencer" é só contorno sobre papel. Em escala de cinza os dois
 *    continuam distintos, e o carmim sólido do "Vencido" domina os dois.
 * 3. **Ícone** — octógono (vencido), triângulo (este mês), relógio de
 *    calendário (a vencer): três silhuetas diferentes.
 * 4. **Peso da fonte** — 700 no "Vencido", 500 nos outros dois.
 * 5. **Marcador de margem** na linha da tabela (ver `MARCADOR_POR_VENCIMENTO`).
 *
 * O quarto caso — vencimento a dois ou mais meses — não tem entrada aqui de
 * propósito: ele não é um status a mais, é a ausência de marcação. Ver
 * {@link SeloDeVencimento}.
 */
export const APRESENTACAO_DE_VENCIMENTO: Record<
  StatusEncaminhamento,
  ApresentacaoDeSelo
> = {
  Vencido: {
    icone: OctagonAlert,
    classe: "bg-esgotada text-white ring-1 ring-esgotada font-bold",
  },
  "Vence este mês": {
    icone: TriangleAlert,
    classe: "bg-renovar-fundo text-renovar ring-1 ring-renovar/40 font-medium",
  },
  "A vencer": {
    icone: CalendarClock,
    classe: "bg-card text-renovar ring-1 ring-renovar/35 font-medium",
  },
};

/**
 * O selo de uma linha da listagem.
 *
 * Devolve `null` para status nulo: encaminhamento com vencimento a dois ou mais
 * meses fica com a célula **neutra**, sem marcação nenhuma. Um quarto rótulo
 * ("em dia", "sem urgência") gastaria atenção com a única linha que não precisa
 * de nenhuma — e o custo de um selo é justamente a atenção que ele cobra.
 */
export function SeloDeVencimento({
  status,
  className,
}: {
  status: StatusEncaminhamento | null;
  className?: string;
}) {
  if (status === null) {
    return null;
  }

  return (
    <SeloDeStatus
      rotulo={status}
      apresentacao={APRESENTACAO_DE_VENCIMENTO[status]}
      className={className}
    />
  );
}

/** O ícone sozinho, para o resumo do topo, onde o rótulo já vai escrito ao lado. */
export function IconeDeVencimento({
  status,
  className,
}: {
  status: StatusEncaminhamento;
  className?: string;
}) {
  return (
    <IconeDeStatus
      apresentacao={APRESENTACAO_DE_VENCIMENTO[status]}
      className={className}
    />
  );
}

/**
 * Marcador de margem da linha da tabela.
 *
 * Mesmo papel do `MARCADOR_POR_STATUS` do painel: é o canal que permite varrer
 * só a borda esquerda da lista e saber onde olhar, sem ler status nenhum. O
 * "A vencer" leva o filete em âmbar rebaixado — a mesma diferença de urgência
 * por peso que o selo faz, não por cor nova. Sem status, filete transparente,
 * para as quatro variações alinharem na mesma coluna de texto.
 */
export const MARCADOR_POR_VENCIMENTO: Record<StatusEncaminhamento, string> = {
  Vencido: "border-l-esgotada bg-esgotada-fundo/50",
  "Vence este mês": "border-l-renovar",
  "A vencer": "border-l-renovar/45",
};

export const MARCADOR_SEM_VENCIMENTO = "border-l-transparent";

/** Cor do número no resumo. A tinta do contador acompanha a do selo. */
export const TINTA_POR_VENCIMENTO: Record<StatusEncaminhamento, string> = {
  Vencido: "text-esgotada",
  "Vence este mês": "text-renovar",
  "A vencer": "text-renovar",
};

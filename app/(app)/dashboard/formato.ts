import type { StatusAlerta } from "@/lib/domain/saldo";

/**
 * Formata uma data "AAAA-MM-DD" como "DD/MM/AAAA".
 *
 * Trabalha em cima do texto de propósito: converter para `Date` faria o dia
 * depender do fuso de quem renderiza (servidor e navegador podem discordar) e
 * a validade apareceria um dia deslocada.
 */
export function formatarData(iso: string | null): string {
  if (!iso) {
    return "—";
  }

  const [ano, mes, dia] = iso.split("-");

  if (!ano || !mes || !dia) {
    return iso;
  }

  return `${dia}/${mes}/${ano}`;
}

/**
 * Normaliza texto para busca: sem acento, sem caixa, sem espaço nas pontas.
 *
 * Sem isso "Joao" não acharia "João" — comum quando se digita rápido.
 */
export function normalizarParaBusca(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Cor de cada status: verde/amarelo/vermelho (item 3 do Prompt 4). */
export const CLASSE_POR_STATUS: Record<StatusAlerta, string> = {
  Regular:
    "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  Renovar:
    "border-amber-600/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  Esgotada: "border-red-600/30 bg-red-500/10 text-red-700 dark:text-red-400",
};

/** Ordem de exibição do resumo, do mais urgente para o menos. */
export const STATUS_EM_ORDEM_DE_URGENCIA: readonly StatusAlerta[] = [
  "Esgotada",
  "Renovar",
  "Regular",
];

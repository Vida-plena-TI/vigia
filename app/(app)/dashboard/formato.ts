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
    return "sem prazo";
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

/**
 * Marcador de margem da linha da tabela.
 *
 * É o canal que permite varrer só a borda esquerda da lista e saber onde
 * olhar, sem ler status nenhum. "Regular" fica com o filete transparente para
 * as três variações alinharem na mesma coluna de texto.
 */
export const MARCADOR_POR_STATUS: Record<StatusAlerta, string> = {
  Regular: "border-l-transparent",
  Renovar: "border-l-renovar",
  Esgotada: "border-l-esgotada bg-esgotada-fundo/50",
};

/** Cor do número no resumo. A tinta do contador acompanha a do selo. */
export const TINTA_POR_STATUS: Record<StatusAlerta, string> = {
  Regular: "text-regular",
  Renovar: "text-renovar",
  Esgotada: "text-esgotada",
};

/**
 * Ordem de exibição do resumo, do mais urgente para o menos.
 *
 * Reexportada de `lib/domain/guias-apresentacao.ts` de propósito: é a mesma
 * precedência que decide o pior status do cabeçalho recolhido do paciente, e
 * duas cópias da ordem acabariam divergindo.
 */
export { STATUS_EM_ORDEM_DE_URGENCIA } from "@/lib/domain/guias-apresentacao";

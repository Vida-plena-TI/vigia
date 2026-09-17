import { cn } from "@/lib/utils";
import {
  STATUS_DE_ENCAMINHAMENTO_EM_ORDEM,
  type ResumoDeEncaminhamentos,
  type StatusEncaminhamento,
} from "@/lib/domain/encaminhamentos";

import { IconeDeVencimento, TINTA_POR_VENCIMENTO } from "./selo-de-vencimento";

/** Legenda de cada status, para quem abre a tela sem conhecer a regra. */
const LEGENDA = {
  Vencido: "Venceu em um mês anterior ao atual.",
  "Vence este mês": "Vence dentro do mês corrente.",
  "A vencer": "Vence no mês que vem.",
} as const;

/**
 * Filete de topo: identifica a coluna antes de o olho chegar no número.
 *
 * Os dois âmbares se separam pelo mesmo recurso que separa os selos — peso, não
 * cor: o filete de "A vencer" é o mesmo âmbar rebaixado.
 */
const TOPO_POR_VENCIMENTO: Record<StatusEncaminhamento, string> = {
  Vencido: "border-t-esgotada",
  "Vence este mês": "border-t-renovar",
  "A vencer": "border-t-renovar/45",
};

/**
 * Contagem de encaminhamentos por status — a leitura de ponteiro desta tela.
 *
 * Mesmo desenho do `ResumoDeStatus` do painel, e de propósito: uma folha só,
 * dividida por filete, e não três cartões soltos — os três números só
 * significam alguma coisa comparados entre si.
 *
 * Reflete a lista inteira, não o filtro de busca: é o painel de alerta dos
 * encaminhamentos da clínica, e ele não deveria mudar quando alguém digita um
 * nome no campo de busca.
 *
 * Os encaminhamentos com vencimento a dois ou mais meses não aparecem em
 * contador nenhum — eles não têm status, e somá-los num quarto número diria
 * "olhe para mim" sobre exatamente as linhas que não pedem nada.
 */
export function ResumoDeVencimentos({
  resumo,
  rotulo = "Resumo de encaminhamentos por vencimento",
}: {
  resumo: ResumoDeEncaminhamentos;
  rotulo?: string;
}) {
  return (
    <section
      aria-label={rotulo}
      className="folha overflow-hidden"
    >
      <div className="grid divide-y divide-regua sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {STATUS_DE_ENCAMINHAMENTO_EM_ORDEM.map((status) => {
          const total = resumo[status];

          return (
            <div
              key={status}
              className={cn(
                "flex flex-col gap-1 border-t-[3px] px-4 py-3",
                TOPO_POR_VENCIMENTO[status],
              )}
            >
              <div
                className={cn(
                  "flex items-center gap-1.5 text-sm font-medium",
                  TINTA_POR_VENCIMENTO[status],
                )}
              >
                <IconeDeVencimento status={status} />
                {status}
              </div>

              {/*
                Serifada aqui, no logotipo e nos contadores do painel, em
                nenhum outro lugar: estes números são a leitura do instrumento,
                não mais um dado de tabela.
              */}
              <span
                className={cn(
                  "font-serif text-4xl font-semibold",
                  total === 0
                    ? "text-muted-foreground"
                    : TINTA_POR_VENCIMENTO[status],
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

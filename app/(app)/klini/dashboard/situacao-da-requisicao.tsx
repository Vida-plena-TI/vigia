"use client";

import { useTransition } from "react";
import { CircleCheck, Clock } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  SeloDeStatus,
  type ApresentacaoDeSelo,
} from "@/components/selo-de-status";
import type { GuiaDoDashboard } from "@/lib/domain/guias";
import { mensagemDeSituacaoAlterada } from "@/lib/domain/requisicoes-mensagens";
import {
  ROTULO_DA_SITUACAO,
  type SituacaoDeRequisicao,
} from "@/lib/domain/situacao-requisicao";
import { alterarSituacaoDaRequisicaoAction } from "@/lib/domain/situacao-requisicao-actions";

/**
 * Apresentação da situação da requisição (Solicitada / Aprovada).
 *
 * Outro vocabulário que o `status_alerta`, então usa a forma genérica de
 * `components/selo-de-status.tsx`, não o `StatusBadge`. E **nenhuma cor
 * saturada**: teal, âmbar e carmim são do saldo e do vencimento. A diferença
 * entre as duas vem de ícone, texto, contorno e peso:
 *
 * - **Solicitada** é o que pede atenção: contorno na tinta grafite, relógio,
 *   peso 600.
 * - **Aprovada** é o estado normal — depois do backfill, quase tudo — e por
 *   isso é só uma marcação discreta: texto suave, check em círculo (silhueta
 *   diferente do `Check` do "Regular"), sem contorno nem fundo, peso 400. Um
 *   selo cheio em cada linha inundaria o painel.
 */
export const APRESENTACAO_DA_SITUACAO: Record<
  SituacaoDeRequisicao,
  ApresentacaoDeSelo
> = {
  solicitada: {
    icone: Clock,
    classe: "bg-card text-foreground ring-1 ring-foreground/60 font-semibold",
  },
  aprovada: {
    icone: CircleCheck,
    classe: "px-0 text-muted-foreground font-normal",
  },
};

export function SeloDeSituacao({
  situacao,
}: {
  situacao: SituacaoDeRequisicao;
}) {
  return (
    <SeloDeStatus
      rotulo={ROTULO_DA_SITUACAO[situacao]}
      apresentacao={APRESENTACAO_DA_SITUACAO[situacao]}
    />
  );
}

/**
 * Selo da situação e, para quem pode alterá-la, o botão que a troca.
 *
 * `podeAlterar` vem da página, decidido por `podeAlterarSituacaoDeRequisicao`
 * com o papel lido do banco. Esconder o botão da recepção é conveniência: a
 * proteção de verdade é a da Server Action, que relê o papel.
 *
 * Vale nos dois sentidos (Aprovar / Voltar para solicitada) para dar conta de
 * um clique errado. A situação é da requisição inteira: o botão de qualquer
 * guia muda todas as guias do mesmo número, e o `aria-label` diz isso pelo
 * número.
 */
export function SituacaoDaRequisicao({
  guia,
  podeAlterar,
}: {
  guia: Pick<
    GuiaDoDashboard,
    "requisicaoId" | "numeroRequisicao" | "pacienteNome" | "situacaoRequisicao"
  >;
  podeAlterar: boolean;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="sr-only">Situação da requisição: </span>
      <SeloDeSituacao situacao={guia.situacaoRequisicao} />
      {podeAlterar ? <BotaoDeSituacao guia={guia} /> : null}
    </span>
  );
}

function BotaoDeSituacao({
  guia,
}: {
  guia: Pick<
    GuiaDoDashboard,
    "requisicaoId" | "numeroRequisicao" | "pacienteNome" | "situacaoRequisicao"
  >;
}) {
  const [pendente, iniciar] = useTransition();

  const aprovar = guia.situacaoRequisicao === "solicitada";
  const destino: SituacaoDeRequisicao = aprovar ? "aprovada" : "solicitada";

  function alterar() {
    iniciar(async () => {
      try {
        const resultado = await alterarSituacaoDaRequisicaoAction(
          guia.requisicaoId,
          destino,
        );

        if (resultado.ok) {
          toast.success(
            mensagemDeSituacaoAlterada(
              resultado.numeroRequisicao,
              resultado.situacao,
            ),
          );
          return;
        }

        toast.error(resultado.erro);
      } catch {
        toast.error("Não foi possível alterar a situação da requisição.");
      }
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      disabled={pendente}
      onClick={alterar}
      aria-label={
        aprovar
          ? `Aprovar a requisição ${guia.numeroRequisicao} de ${guia.pacienteNome} (todas as terapias dela)`
          : `Voltar a requisição ${guia.numeroRequisicao} de ${guia.pacienteNome} para solicitada (todas as terapias dela)`
      }
    >
      {pendente ? "Salvando..." : aprovar ? "Aprovar" : "Voltar para solicitada"}
    </Button>
  );
}

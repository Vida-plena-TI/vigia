"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { escreverNaAreaDeTransferencia } from "./area-de-transferencia";

/** Quanto tempo o botão fica em "Copiado" depois de copiar. */
const MS_DE_CONFIRMACAO = 2000;

/**
 * Copiar para a área de transferência com o aviso de "copiou".
 *
 * Todo botão de copiar do sistema (o de um paciente e o do lote de
 * selecionados no painel, os de carteirinha e CRM em Encaminhamentos) precisa
 * do mesmo comportamento: mesmo plano B fora de contexto seguro, mesmo toast
 * de falha e mesmos 2s de confirmação. Duas cópias disso acabariam divergindo
 * — o hook é o único lugar onde a regra mora. Morava em
 * `app/(app)/klini/dashboard/` enquanto só o painel copiava; subiu para cá
 * quando Encaminhamentos virou o segundo consumidor.
 *
 * O sucesso não vira toast de propósito: copiar é gesto repetido no
 * atendimento, e um toast a cada vez viraria ruído. Quem chama transforma
 * `copiado` em sinal visual (troca de silhueta do ícone, "Copiado" por
 * escrito) e numa região `role="status"` para quem não vê o botão.
 */
export function useCopiaParaAreaDeTransferencia() {
  const [copiado, setCopiado] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sem isso, um paciente que sai da lista pelo filtro logo depois do clique
  // deixaria um setState apontando para um componente já desmontado.
  useEffect(() => {
    return () => {
      if (temporizador.current !== null) {
        clearTimeout(temporizador.current);
      }
    };
  }, []);

  const copiar = useCallback(async (texto: string) => {
    if (!(await escreverNaAreaDeTransferencia(texto))) {
      // A mensagem não repete o texto: pode ser carteirinha ou CRM, que não
      // vão para mensagem nenhuma. O valor continua na tela para cópia manual.
      toast.error(
        "Não foi possível copiar. Selecione o texto e copie manualmente.",
      );
      return;
    }

    setCopiado(true);

    if (temporizador.current !== null) {
      clearTimeout(temporizador.current);
    }

    temporizador.current = setTimeout(() => {
      setCopiado(false);
      temporizador.current = null;
    }, MS_DE_CONFIRMACAO);
  }, []);

  return { copiado, copiar };
}

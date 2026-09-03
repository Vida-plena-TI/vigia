"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/** Quanto tempo o ícone fica em "check" depois de copiar. */
const MS_DE_CONFIRMACAO = 2000;

/**
 * Copiar para a área de transferência com o aviso de "copiou" do painel.
 *
 * Os dois botões de copiar do painel (o de um paciente e o do lote de
 * selecionados) precisam do mesmo comportamento: mesma checagem de contexto
 * seguro, mesmo toast de falha e mesmos 2s de confirmação. Duas cópias disso
 * acabariam divergindo — o hook é o único lugar onde a regra mora.
 *
 * O sucesso não vira toast de propósito: copiar é gesto repetido no
 * atendimento, e um toast a cada vez viraria ruído. Quem chama transforma
 * `copiado` em sinal visual (troca de silhueta do ícone) e numa região
 * `role="status"` para quem não vê o ícone.
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
    // `navigator.clipboard` não existe fora de contexto seguro (http servido
    // por IP na rede da clínica, por exemplo). Avisar é melhor do que estourar
    // um TypeError sem explicação.
    if (!navigator.clipboard?.writeText) {
      toast.error(
        "A área de transferência não está disponível neste navegador.",
      );
      return;
    }

    try {
      await navigator.clipboard.writeText(texto);
    } catch {
      toast.error("Não foi possível copiar.");
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

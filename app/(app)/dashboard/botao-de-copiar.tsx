"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { textoDeCopia } from "@/lib/domain/guias-apresentacao";
import type { PacienteComGuias } from "@/lib/domain/guias";

/** Quanto tempo o ícone fica em "check" depois de copiar. */
const MS_DE_CONFIRMACAO = 2000;

/**
 * Copia `"Nome do paciente - Número da requisição"` para a área de
 * transferência.
 *
 * Fica **fora** do botão que abre e fecha o paciente, como irmão dele no
 * cabeçalho: aninhar um botão dentro do outro é HTML inválido, e mesmo com
 * `stopPropagation` o clique em copiar acabaria abrindo o paciente sem querer.
 * Por isso o cabeçalho é uma linha com dois controles independentes.
 *
 * O aviso de sucesso é o próprio ícone virando "check" por 2s — silencioso, já
 * que copiar é gesto repetido no atendimento e um toast a cada vez viraria
 * ruído. Quem não vê o ícone recebe o aviso pela região `role="status"`. Toast
 * fica só para a falha, que é o caso que precisa de explicação.
 */
export function BotaoDeCopiar({ paciente }: { paciente: PacienteComGuias }) {
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

  async function copiar() {
    const texto = textoDeCopia(paciente.nome, paciente.guias);

    // `navigator.clipboard` não existe fora de contexto seguro (http servido
    // por IP na rede da clínica, por exemplo). Avisar é melhor do que estourar
    // um TypeError sem explicação.
    if (!navigator.clipboard?.writeText) {
      toast.error("A área de transferência não está disponível neste navegador.");
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
  }

  const Icone = copiado ? Check : Copy;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        // O nome entra no rótulo porque, numa lista de pacientes, "Copiar"
        // sozinho não diz de quem — e é assim que o leitor de tela navega
        // botão a botão.
        aria-label={`Copiar nome e número da requisição de ${paciente.nome}`}
        onClick={copiar}
      >
        {/*
          O sinal de "copiou" é a troca de silhueta, não uma cor: teal, âmbar e
          carmim são reservados para `status_alerta` (CONTEXT.md, "Sistema de
          design"), e um check verde aqui gastaria uma cor que significa outra
          coisa na mesma tela.
        */}
        <Icone aria-hidden />
      </Button>

      {/*
        O ícone é sinal visual; esta região é o equivalente audível dele. Fica
        sempre montada para o leitor de tela anunciar a mudança de conteúdo em
        vez de ignorar um nó que acabou de nascer.
      */}
      <span role="status" aria-live="polite" className="sr-only">
        {copiado ? `Copiado: ${textoDeCopia(paciente.nome, paciente.guias)}` : ""}
      </span>
    </>
  );
}

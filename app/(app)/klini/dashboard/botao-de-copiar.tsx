"use client";

import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { textoDeCopia } from "@/lib/domain/guias-apresentacao";
import type { PacienteComGuias } from "@/lib/domain/guias";

import { useCopiaParaAreaDeTransferencia } from "./usar-copia";

/**
 * Copia `"Nome do paciente - Número da requisição"` para a área de
 * transferência.
 *
 * Fica **fora** do botão que abre e fecha o paciente, como irmão dele no
 * cabeçalho: aninhar um botão dentro do outro é HTML inválido, e mesmo com
 * `stopPropagation` o clique em copiar acabaria abrindo o paciente sem querer.
 * Por isso o cabeçalho é uma linha com controles independentes — o mesmo
 * cuidado vale para o checkbox de seleção do outro lado da linha.
 *
 * Convive com o "Copiar selecionados" da barra de seleção: este é o atalho de
 * um paciente só, sem precisar marcar nada. Os dois usam o mesmo
 * `useCopiaParaAreaDeTransferencia` e o mesmo `textoDeCopia`, então o texto
 * colado é idêntico pelos dois caminhos.
 *
 * O aviso de sucesso é o próprio ícone virando "check" por 2s — silencioso, já
 * que copiar é gesto repetido no atendimento e um toast a cada vez viraria
 * ruído. Quem não vê o ícone recebe o aviso pela região `role="status"`. Toast
 * fica só para a falha, que é o caso que precisa de explicação.
 */
export function BotaoDeCopiar({ paciente }: { paciente: PacienteComGuias }) {
  const { copiado, copiar } = useCopiaParaAreaDeTransferencia();

  const texto = textoDeCopia(paciente.nome, paciente.guias);
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
        onClick={() => copiar(texto)}
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
        {copiado ? `Copiado: ${texto}` : ""}
      </span>
    </>
  );
}

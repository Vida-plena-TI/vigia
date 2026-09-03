"use client";

import { Check, Copy, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { textoDeCopiaEmLote } from "@/lib/domain/guias-apresentacao";
import type { PacienteComGuias } from "@/lib/domain/guias";

import { useCopiaParaAreaDeTransferencia } from "./usar-copia";

/**
 * A barra que aparece quando há pelo menos um paciente marcado.
 *
 * Fica grudada no topo da janela (`sticky`) porque marcar é gesto de rolagem:
 * quem desce o livro-razão marcando pacientes precisa do botão ao alcance sem
 * ter que voltar ao topo. Ela é superfície de dado (`.folha`) e não uma barra
 * flutuante colorida — o painel inteiro é um instrumento em grafite e papel, e
 * cor aqui roubaria atenção de `status_alerta`.
 *
 * **A seleção não é limpa depois de copiar.** O usuário confere o que colou,
 * ajusta e copia de novo; limpar sozinho obrigaria a remarcar tudo por causa
 * de um paciente errado. Quem quer zerar usa o "Limpar seleção" ao lado, que
 * só existe enquanto há algo marcado.
 */
export function BarraDeSelecao({
  selecionados,
  aoLimpar,
}: {
  /** Já na ordem do painel — é a ordem em que as linhas serão coladas. */
  selecionados: PacienteComGuias[];
  aoLimpar: () => void;
}) {
  const { copiado, copiar } = useCopiaParaAreaDeTransferencia();

  const total = selecionados.length;
  const texto = textoDeCopiaEmLote(selecionados);

  const Icone = copiado ? Check : Copy;

  return (
    <div className="folha sticky top-0 z-10 flex flex-wrap items-center gap-2 border-regua-forte px-3 py-2">
      <Button type="button" size="lg" onClick={() => copiar(texto)}>
        {/*
          Mesma troca de silhueta do botão individual (`Copy` -> `Check`, 2s),
          sem trocar o rótulo: o número de pacientes é o que o botão precisa
          dizer o tempo todo, inclusive nos 2s de confirmação.
        */}
        <Icone aria-hidden />
        Copiar {total} selecionado{total === 1 ? "" : "s"}
      </Button>

      <Button type="button" variant="ghost" size="lg" onClick={aoLimpar}>
        <X aria-hidden />
        Limpar seleção
      </Button>

      {/* O equivalente audível da troca de ícone, como no botão individual. */}
      <span role="status" aria-live="polite" className="sr-only">
        {copiado
          ? `${total} paciente(s) copiado(s) para a área de transferência.`
          : ""}
      </span>
    </div>
  );
}

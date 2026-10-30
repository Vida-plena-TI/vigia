"use client";

/**
 * O "Remover encaminhamento" da lista de Encaminhamentos da Klini.
 *
 * Apaga **só** a linha de `encaminhamento`: o paciente, as requisições, as
 * guias e os atendimentos ficam. Por isso a confirmação é simples (um clique
 * no diálogo), como a de `ExcluirAutorizacao` na SulAmérica, e não a digitada
 * da exclusão permanente — que desde 30/10/2026 mora no "Excluir" da aba
 * Cadastro. O aviso do diálogo diz a consequência (regra 15).
 *
 * Como nos outros diálogos de exclusão, o `preventDefault` no clique impede o
 * Radix de fechar, e o erro devolvido pela action aparece dentro do diálogo.
 */

import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { removerEncaminhamentoAction } from "@/lib/domain/encaminhamentos-actions";
import {
  AVISO_REMOCAO_DE_ENCAMINHAMENTO,
  mensagemDeRemocao,
} from "@/lib/domain/encaminhamentos-mensagens";

const ERRO_AO_REMOVER =
  "Não foi possível remover o encaminhamento. Tente de novo.";

export function RemoverEncaminhamento({
  encaminhamentoId,
  pacienteNome,
}: {
  encaminhamentoId: number;
  pacienteNome: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [removendo, iniciar] = useTransition();

  function confirmar() {
    setErro(null);

    iniciar(async () => {
      try {
        const resultado = await removerEncaminhamentoAction(encaminhamentoId);

        if (!resultado.ok) {
          setErro(resultado.erro);
          return;
        }

        setAberto(false);
        toast.success(mensagemDeRemocao(resultado.pacienteNome));
      } catch {
        setErro(ERRO_AO_REMOVER);
      }
    });
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        aria-label={`Remover encaminhamento de ${pacienteNome}`}
        onClick={() => {
          setErro(null);
          setAberto(true);
        }}
      >
        Remover encaminhamento
      </Button>

      <AlertDialog
        open={aberto}
        onOpenChange={(proximo) => {
          if (!removendo) setAberto(proximo);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remover o encaminhamento de {pacienteNome}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {AVISO_REMOCAO_DE_ENCAMINHAMENTO}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {erro ? (
            <p role="alert" className="aviso-de-erro">
              {erro}
            </p>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={removendo}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              className="bg-esgotada text-white hover:bg-esgotada/90"
              disabled={removendo}
              // Sem o preventDefault o Radix fecha o diálogo no clique e o
              // erro devolvido pela action não chegaria a aparecer.
              onClick={(evento) => {
                evento.preventDefault();
                confirmar();
              }}
            >
              {removendo ? "Removendo..." : "Remover encaminhamento"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

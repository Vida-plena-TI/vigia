"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { excluirAutorizacaoAction } from "@/lib/domain/autorizacoes-sulamerica-actions";

export function ExcluirAutorizacao({ id, pacienteNome }: { id: number; pacienteNome: string }) {
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  return (
    <>
      <Button variant="outline" size="sm" aria-label={`Excluir autorização de ${pacienteNome}`}
        onClick={() => { setErro(null); setAberto(true); }}>Excluir</Button>
      <AlertDialog open={aberto} onOpenChange={(valor) => { if (!pendente) setAberto(valor); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir autorização de {pacienteNome}?</AlertDialogTitle>
            <AlertDialogDescription>
              A autorização SulAmérica será removida. O cadastro do paciente,
              suas requisições e seus atendimentos serão mantidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {erro ? <p role="alert" className="aviso-de-erro">{erro}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendente}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={pendente} variant="destructive"
              className="bg-esgotada text-white hover:bg-esgotada/90"
              onClick={(evento) => {
                evento.preventDefault();
                setErro(null);
                iniciar(async () => {
                  try {
                    const resultado = await excluirAutorizacaoAction(id);
                    if (!resultado.ok) { setErro(resultado.erro); return; }
                    setAberto(false);
                    toast.success(`Autorização de ${pacienteNome} excluída.`);
                  } catch { setErro("Não foi possível excluir a autorização. Tente de novo."); }
                });
              }}>
              {pendente ? "Excluindo..." : "Excluir autorização"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

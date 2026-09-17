"use client";

/**
 * O botão "Excluir" da listagem de encaminhamentos — e a fricção que o segue.
 *
 * Este componente é o único do sistema que dispara uma ação **sem volta**: a
 * Server Action que ele chama apaga o paciente, as requisições, as guias, os
 * atendimentos e o encaminhamento, em DELETE de verdade. Não há lixeira, não há
 * arquivamento, não há como restaurar pela aplicação. A decisão está registrada
 * em CONTEXT.md ("Exclusão permanente de paciente"), com a ressalva sobre
 * guarda de prontuário que o usuário conhecia ao tomá-la.
 *
 * Daí o desenho ser deliberadamente mais lento que o dos outros diálogos de
 * exclusão do sistema, em três pontos:
 *
 *   1. **O clique no botão não abre o diálogo — ele consulta o banco.** A
 *      contagem de requisições e atendimentos é lida antes, e o diálogo só
 *      aparece com os números reais na frase. "Todos os dados relacionados"
 *      seria mais fácil de escrever e não diria nada: 0 atendimentos e 300
 *      atendimentos são decisões diferentes.
 *   2. **A confirmação é digitada, não clicada.** Dois cliques em "sim"
 *      seguidos são um gesto só na prática; digitar uma palavra obriga a
 *      parar. É o padrão de qualquer operação destrutiva irreversível.
 *   3. **O diálogo não fecha no erro.** Como no `ExcluirGuia` do painel, o
 *      `preventDefault` no clique impede o Radix de fechar, e a mensagem
 *      devolvida pela action aparece dentro do próprio diálogo.
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
// Só o tipo: `import type` some na compilação, então o Prisma que
// `lib/domain/pacientes.ts` importa não vai junto para o bundle do navegador.
// Mesma forma que `lista-de-encaminhamentos.tsx` usa para `EncaminhamentoNaLista`.
import type { ContagemParaExclusao } from "@/lib/domain/pacientes";
import {
  contarParaExcluirPaciente,
  excluirPaciente,
} from "@/lib/domain/pacientes-actions";
import {
  confirmacaoValida,
  fraseDeExclusao,
  mensagemDeExclusao,
  PALAVRA_DE_CONFIRMACAO,
} from "@/lib/domain/pacientes-mensagens";

const ERRO_AO_CONTAR =
  "Não foi possível verificar o que seria apagado. Tente de novo.";

const ERRO_AO_EXCLUIR = "Não foi possível excluir o cadastro.";

export function ExcluirPaciente({
  pacienteId,
  pacienteNome,
}: {
  pacienteId: number;
  pacienteNome: string;
}) {
  /**
   * A contagem lida do banco. `null` enquanto o diálogo não deve aparecer — é
   * ela, e não um `aberto: boolean`, que controla a abertura: o diálogo não
   * existe sem os números que ele precisa citar.
   */
  const [contagem, setContagem] = useState<ContagemParaExclusao | null>(null);
  const [digitado, setDigitado] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [contando, iniciarContagem] = useTransition();
  const [excluindo, iniciarExclusao] = useTransition();

  function abrir() {
    setErro(null);

    iniciarContagem(async () => {
      try {
        const resultado = await contarParaExcluirPaciente(pacienteId);

        if (!resultado.ok) {
          // Ex.: o paciente sumiu desde que a página foi renderizada. Vira
          // toast porque ainda não há diálogo onde escrever.
          toast.error(resultado.erro);
          return;
        }

        setDigitado("");
        setContagem(resultado.contagem);
      } catch {
        toast.error(ERRO_AO_CONTAR);
      }
    });
  }

  function fechar(proximo: boolean) {
    if (proximo) {
      return;
    }

    setContagem(null);
    setDigitado("");
    setErro(null);
  }

  function confirmar() {
    setErro(null);

    iniciarExclusao(async () => {
      try {
        const resultado = await excluirPaciente(pacienteId);

        if (!resultado.ok) {
          setErro(resultado.erro);
          return;
        }

        setContagem(null);
        setDigitado("");

        toast.success(mensagemDeExclusao(resultado.pacienteNome), {
          // O que a transação de fato apagou, não o que o diálogo previu —
          // entre uma coisa e outra o banco pode ter mudado.
          description:
            `${resultado.requisicoes} requisição(ões), ` +
            `${resultado.guias} guia(s) e ` +
            `${resultado.atendimentos} atendimento(s).`,
        });
      } catch {
        setErro(ERRO_AO_EXCLUIR);
      }
    });
  }

  const liberado = confirmacaoValida(digitado);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={contando}
        onClick={abrir}
        aria-label={`Excluir cadastro de ${pacienteNome}`}
      >
        {contando ? "Verificando..." : "Excluir"}
      </Button>

      <AlertDialog open={contagem !== null} onOpenChange={fechar}>
        {contagem === null ? null : (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Excluir permanentemente o cadastro de {contagem.pacienteNome}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {fraseDeExclusao(
                  contagem.pacienteNome,
                  contagem.requisicoes,
                  contagem.atendimentos,
                  contagem.temAutorizacaoSulamerica,
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`confirmacao-${pacienteId}`} className="text-xs">
                Digite {PALAVRA_DE_CONFIRMACAO} para liberar o botão
              </Label>
              <Input
                id={`confirmacao-${pacienteId}`}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder={PALAVRA_DE_CONFIRMACAO}
                value={digitado}
                disabled={excluindo}
                onChange={(evento) => setDigitado(evento.target.value)}
              />
            </div>

            {erro ? (
              <p role="alert" className="aviso-de-erro">
                {erro}
              </p>
            ) : null}

            <AlertDialogFooter>
              <AlertDialogCancel disabled={excluindo}>
                Cancelar
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                className="bg-esgotada text-white hover:bg-esgotada/90"
                disabled={!liberado || excluindo}
                // Sem o preventDefault o Radix fecha o diálogo no clique e o
                // erro devolvido pela action não chegaria a aparecer.
                onClick={(evento) => {
                  evento.preventDefault();
                  confirmar();
                }}
              >
                {excluindo ? "Excluindo..." : "Excluir tudo"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </>
  );
}

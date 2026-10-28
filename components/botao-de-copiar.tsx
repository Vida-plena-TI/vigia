"use client";

import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useCopiaParaAreaDeTransferencia } from "./usar-copia";

/**
 * Botão que copia um texto para a área de transferência.
 *
 * Nasceu no painel (`app/(app)/klini/dashboard/`), copiando "Nome - Número da
 * requisição"; subiu para cá — movido, não copiado — quando Encaminhamentos
 * passou a copiar carteirinha e CRM. O que é de cada tela (o texto, o rótulo
 * acessível) chega por prop; o que é do sistema (o aviso, a falha, os 2s) mora
 * aqui e em `usar-copia.ts`.
 *
 * Copia **exatamente** `texto`. Quem chama decide o que é o valor — sem
 * rótulo, sem espaço sobrando.
 *
 * Duas formas:
 * - sem `rotulo`, só o ícone (o cabeçalho do paciente no painel, a
 *   carteirinha e o CRM em Encaminhamentos);
 * - com `rotulo`, ícone e texto, e o texto vira "Copiado" durante a
 *   confirmação. Nenhuma tela usa hoje; fica para quando o ícone sozinho não
 *   bastar.
 *
 * O aviso de sucesso é a troca de silhueta do ícone (e da palavra), não uma
 * cor: teal, âmbar e carmim são reservados para status (CONTEXT.md, "Sistema
 * de design"). Quem não vê o botão recebe o aviso pela região `role="status"`.
 * Toast fica só para a falha, que é o caso que precisa de explicação.
 */
export function BotaoDeCopiar({
  texto,
  rotuloAcessivel,
  aviso,
  rotulo,
  title,
  disabled = false,
  size,
  className,
}: {
  texto: string;
  /**
   * Nome acessível do botão. Numa lista, "Copiar" sozinho não diz de quem —
   * e é assim que o leitor de tela navega botão a botão; por isso o nome do
   * paciente entra aqui.
   */
  rotuloAcessivel: string;
  /** O que a região `role="status"` anuncia. Padrão: "Copiado: <texto>". */
  aviso?: string;
  /** Texto visível ao lado do ícone. Sem ele, o botão é só ícone. */
  rotulo?: string;
  /**
   * Dica ao passar o mouse. Útil no botão só com ícone, em que quem enxerga
   * não tem texto nenhum dizendo o que ele copia.
   */
  title?: string;
  disabled?: boolean;
  size?: "sm" | "default" | "lg" | "icon-sm" | "icon" | "icon-lg";
  className?: string;
}) {
  const { copiado, copiar } = useCopiaParaAreaDeTransferencia();

  const Icone = copiado ? Check : Copy;

  return (
    <>
      <Button
        type="button"
        variant={rotulo ? "outline" : "ghost"}
        size={size ?? (rotulo ? "sm" : "icon-sm")}
        className={cn(rotulo && "min-w-[6.5rem]", className)}
        aria-label={rotuloAcessivel}
        title={title}
        disabled={disabled}
        onClick={() => copiar(texto)}
      >
        <Icone aria-hidden />
        {rotulo ? (copiado ? "Copiado" : rotulo) : null}
      </Button>

      {/*
        O ícone é sinal visual; esta região é o equivalente audível dele. Fica
        sempre montada para o leitor de tela anunciar a mudança de conteúdo em
        vez de ignorar um nó que acabou de nascer.
      */}
      <span role="status" aria-live="polite" className="sr-only">
        {copiado ? (aviso ?? `Copiado: ${texto}`) : ""}
      </span>
    </>
  );
}

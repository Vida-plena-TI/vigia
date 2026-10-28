"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Campos de carteirinha e CRM dos dois formulários de encaminhamento (Klini e
 * SulAmérica), para rótulo, "(opcional)" e texto de apoio serem os mesmos.
 * Controlados: quem guarda o valor e valida é o formulário.
 */
export function CampoDeCarteirinha({
  valor,
  aoMudar,
  opcional,
  invalido,
}: {
  valor: string;
  aoMudar: (valor: string) => void;
  /** Paciente digitado já tem carteirinha: vazio mantém a cadastrada. */
  opcional: boolean;
  invalido: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5 sm:w-48">
      <Label htmlFor="numeroCarteirinha" className="text-xs">
        Nº da carteirinha
        {opcional ? (
          <span className="font-normal text-muted-foreground">(opcional)</span>
        ) : null}
      </Label>
      <Input
        id="numeroCarteirinha"
        name="numeroCarteirinha"
        autoComplete="off"
        spellCheck={false}
        maxLength={40}
        className="h-9"
        value={valor}
        placeholder={opcional ? "Manter a cadastrada" : undefined}
        aria-describedby="numeroCarteirinha-apoio"
        aria-invalid={invalido ? true : undefined}
        onChange={(evento) => aoMudar(evento.target.value)}
      />
      <p id="numeroCarteirinha-apoio" className="text-xs text-muted-foreground">
        Opcional se o paciente já tem carteirinha cadastrada.
      </p>
    </div>
  );
}

export function CampoDeCrm({
  valor,
  aoMudar,
  invalido,
}: {
  valor: string;
  aoMudar: (valor: string) => void;
  invalido: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5 sm:w-32">
      <Label htmlFor="crmMedico" className="text-xs">
        CRM do médico
      </Label>
      <Input
        id="crmMedico"
        name="crmMedico"
        inputMode="numeric"
        autoComplete="off"
        maxLength={20}
        className="h-9"
        value={valor}
        aria-invalid={invalido ? true : undefined}
        onChange={(evento) => aoMudar(evento.target.value)}
      />
    </div>
  );
}

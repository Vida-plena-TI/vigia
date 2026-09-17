"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  criarAutorizacaoAction,
  type EstadoNovaAutorizacao,
} from "@/lib/domain/autorizacoes-sulamerica-actions";
import {
  ERRO_DATA_INVALIDA,
  ERRO_PRAZO_INVALIDO,
  ERRO_PACIENTE_OBRIGATORIO,
  mensagemDeCadastro,
} from "@/lib/domain/autorizacoes-sulamerica-mensagens";

import { formatarData } from "../../klini/dashboard/formato";

const ESTADO_INICIAL: EstadoNovaAutorizacao = {};

export function FormularioDeAutorizacao({
  nomesDePacientes,
  hoje,
}: {
  nomesDePacientes: string[];

  hoje: string;
}) {
  const [estado, action] = useActionState(
    criarAutorizacaoAction,
    ESTADO_INICIAL,
  );

  const campoPacienteRef = useRef<HTMLInputElement>(null);
  const tokenTratado = useRef<string | null>(null);
  const [pacienteNome, setPacienteNome] = useState("");
  const [dataInicio, setDataInicio] = useState(hoje);
  const [prazoMeses, setPrazoMeses] = useState("");
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  const [mensagemDeSucesso, setMensagemDeSucesso] = useState<string | null>(
    null,
  );
  const erroExibido = erroLocal ?? estado.erro;

  useEffect(() => {
    const sucesso = estado.sucesso;

    if (!sucesso || tokenTratado.current === sucesso.token) {
      return;
    }

    tokenTratado.current = sucesso.token;
    const mensagem = mensagemDeCadastro(
      sucesso.pacienteNome,
      sucesso.substituiuAnterior,
    );

    toast.success(mensagem, {
      description: `Vence em ${formatarData(sucesso.dataVencimento)}.`,
    });

    setMensagemDeSucesso(mensagem);
    setPacienteNome("");
    setDataInicio(hoje);
    setPrazoMeses("");
    setErroLocal(null);

    requestAnimationFrame(() => campoPacienteRef.current?.focus());
  }, [estado, hoje]);

  function validarNoCliente(evento: React.FormEvent<HTMLFormElement>) {
    setMensagemDeSucesso(null);

    if (!pacienteNome.trim()) {
      evento.preventDefault();
      setErroLocal(ERRO_PACIENTE_OBRIGATORIO);
      return;
    }

    if (!dataInicio.trim()) {
      evento.preventDefault();
      setErroLocal(ERRO_DATA_INVALIDA);
      return;
    }

    if (!prazoMeses) {
      evento.preventDefault();
      setErroLocal(ERRO_PRAZO_INVALIDO);
      return;
    }

    setErroLocal(null);
  }

  return (
    <form
      action={action}
      onSubmit={validarNoCliente}
      noValidate
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor="pacienteNome" className="text-xs">
            Nome do paciente
          </Label>
          <Input
            ref={campoPacienteRef}
            id="pacienteNome"
            name="pacienteNome"
            list="pacientes-existentes"
            autoComplete="off"
            className="h-9"
            value={pacienteNome}
            aria-invalid={
              erroExibido === ERRO_PACIENTE_OBRIGATORIO ? true : undefined
            }
            onChange={(evento) => {
              setMensagemDeSucesso(null);
              setPacienteNome(evento.target.value);
            }}
            placeholder="Digite ou escolha um paciente"
          />

          <datalist id="pacientes-existentes">
            {nomesDePacientes.map((nome) => (
              <option key={nome} value={nome} />
            ))}
          </datalist>
        </div>

        <div className="flex flex-col gap-1.5 sm:w-44">
          <Label htmlFor="dataInicio" className="text-xs">
            Data de início
          </Label>
          <Input
            id="dataInicio"
            name="dataInicio"
            type="date"
            className="h-9"
            value={dataInicio}
            onChange={(evento) => {
              setMensagemDeSucesso(null);
              setDataInicio(evento.target.value);
            }}
          />
        </div>

        <div className="flex flex-col gap-1.5 sm:w-36">
          <Label htmlFor="prazoMeses" className="text-xs">Prazo</Label>
          <select id="prazoMeses" name="prazoMeses" required
            value={prazoMeses} onChange={(evento) => setPrazoMeses(evento.target.value)}
            aria-invalid={erroExibido === ERRO_PRAZO_INVALIDO || undefined}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
            <option value="" disabled>Escolha o prazo</option>
            <option value="3">3 meses</option>
            <option value="6">6 meses</option>
            <option value="12">12 meses</option>
          </select>
        </div>
        <BotaoDeSubmit />
      </div>

      {erroExibido ? (
        <p role="alert" className="aviso-de-erro">
          {erroExibido}
        </p>
      ) : null}

      {mensagemDeSucesso ? (
        <p role="status" className="text-sm font-medium text-regular">
          {mensagemDeSucesso}
        </p>
      ) : null}
    </form>
  );
}

function BotaoDeSubmit() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className="h-9 sm:mb-0" disabled={pending}>
      {pending ? "Salvando..." : "Registrar autorização"}
    </Button>
  );
}

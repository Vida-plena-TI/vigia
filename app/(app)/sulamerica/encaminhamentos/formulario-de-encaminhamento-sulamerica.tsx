"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import { CampoDeCarteirinha, CampoDeCrm } from "@/components/campos-carteirinha-crm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSituacaoDaCarteirinha } from "@/components/usar-situacao-da-carteirinha";
import {
  criarEncaminhamentoSulamericaAction,
  type EstadoNovoEncaminhamentoSulamerica,
} from "@/lib/domain/autorizacoes-sulamerica-actions";
import {
  ERRO_DATA_INVALIDA,
  ERRO_PACIENTE_OBRIGATORIO,
  ERRO_PRAZO_INVALIDO,
  mensagemDeCadastro,
} from "@/lib/domain/autorizacoes-sulamerica-mensagens";
import {
  decidirCarteirinha,
  ehErroDaCarteirinha,
  ehErroDoCrm,
  validarCrm,
} from "@/lib/domain/carteirinha-crm";
import { ehErroDoNomeMedico, validarNomeMedico } from "@/lib/domain/nome-medico";
import type { PacienteParaEncaminhamento } from "@/lib/domain/pacientes";

import { formatarData } from "../../klini/dashboard/formato";

const ESTADO_INICIAL: EstadoNovoEncaminhamentoSulamerica = {};

/**
 * Mesmo desenho do formulário de encaminhamento da Klini: inline, campos
 * controlados (o React 19 limparia os não controlados no erro), sucesso sem
 * navegação, limpeza e foco no nome. A validação daqui é conveniência; quem
 * recusa é a Server Action, com as mesmas funções.
 *
 * O prazo volta para "sem escolha" (regra 18: escolha explícita, sem opção
 * pré-selecionada); a data volta para hoje.
 */
export function FormularioDeEncaminhamentoSulamerica({
  pacientes,
  hoje,
}: {
  pacientes: PacienteParaEncaminhamento[];
  /** "AAAA-MM-DD" vinda do `CURRENT_DATE` do banco. */
  hoje: string;
}) {
  const [estado, action] = useActionState(criarEncaminhamentoSulamericaAction, ESTADO_INICIAL);

  const campoPacienteRef = useRef<HTMLInputElement>(null);
  const tokenTratado = useRef<string | null>(null);
  const [pacienteNome, setPacienteNome] = useState("");
  const [dataInicio, setDataInicio] = useState(hoje);
  const [prazoMeses, setPrazoMeses] = useState("");
  const [numeroCarteirinha, setNumeroCarteirinha] = useState("");
  const [crmMedico, setCrmMedico] = useState("");
  const [nomeMedico, setNomeMedico] = useState("");
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  const [mensagemDeSucesso, setMensagemDeSucesso] = useState<string | null>(null);
  const erroExibido = erroLocal ?? estado.erro;

  const situacaoDaCarteirinha = useSituacaoDaCarteirinha(pacientes, pacienteNome);
  const carteirinhaOpcional = situacaoDaCarteirinha === "com-carteirinha";

  useEffect(() => {
    const sucesso = estado.sucesso;
    if (!sucesso || tokenTratado.current === sucesso.token) {
      return;
    }
    tokenTratado.current = sucesso.token;

    const mensagem = mensagemDeCadastro(sucesso.pacienteNome, sucesso.substituiuAnterior);
    toast.success(mensagem, { description: `Vence em ${formatarData(sucesso.dataVencimento)}.` });

    setMensagemDeSucesso(mensagem);
    setPacienteNome("");
    setDataInicio(hoje);
    setPrazoMeses("");
    // Dados do paciente e do médico não passam para o próximo da fila.
    setNumeroCarteirinha("");
    setCrmMedico("");
    setNomeMedico("");
    setErroLocal(null);

    requestAnimationFrame(() => campoPacienteRef.current?.focus());
  }, [estado, hoje]);

  function mudou<T>(setter: (valor: T) => void) {
    return (valor: T) => {
      setMensagemDeSucesso(null);
      setter(valor);
    };
  }

  /** Na ordem dos campos; `preventDefault` cancela a submissão. */
  function validarNoCliente(evento: React.FormEvent<HTMLFormElement>) {
    setMensagemDeSucesso(null);

    const erro = !pacienteNome.trim()
      ? ERRO_PACIENTE_OBRIGATORIO
      : !dataInicio.trim()
        ? ERRO_DATA_INVALIDA
        : !prazoMeses
          ? ERRO_PRAZO_INVALIDO
          : [
              decidirCarteirinha(numeroCarteirinha, situacaoDaCarteirinha),
              validarCrm(crmMedico),
              validarNomeMedico(nomeMedico),
            ].find((resultado) => !resultado.ok)?.erro;

    if (erro) {
      evento.preventDefault();
      setErroLocal(erro);
      return;
    }

    setErroLocal(null);
  }

  return (
    <form action={action} onSubmit={validarNoCliente} noValidate className="flex flex-col gap-4">
      {/*
        Duas faixas, cada uma com `sm:items-start` (o texto de apoio da
        carteirinha deixa a coluna dela mais alta). Na primeira, entre `sm` e
        `lg` o nome ocupa a linha inteira e data e prazo quebram embaixo; em
        `lg` os três ficam numa linha. Na segunda, o nome do médico cresce para
        ocupar o que sobra, e o botão quebra se não couber.
      */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start lg:flex-nowrap">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:basis-full lg:basis-0">
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
              aria-invalid={erroExibido === ERRO_PACIENTE_OBRIGATORIO ? true : undefined}
              onChange={(evento) => mudou(setPacienteNome)(evento.target.value)}
              placeholder="Digite ou escolha um paciente"
            />
            {/* Sugere, não restringe: nome fora da lista cria o paciente. */}
            <datalist id="pacientes-existentes">
              {pacientes.map(({ nome }) => (
                <option key={nome} value={nome} />
              ))}
            </datalist>
          </div>

          <div className="flex flex-col gap-1.5 sm:w-44">
            <Label htmlFor="dataInicio" className="text-xs">
              Data do encaminhamento
            </Label>
            <Input
              id="dataInicio"
              name="dataInicio"
              type="date"
              className="h-9"
              value={dataInicio}
              aria-invalid={erroExibido === ERRO_DATA_INVALIDA ? true : undefined}
              onChange={(evento) => mudou(setDataInicio)(evento.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5 sm:w-36">
            <Label htmlFor="prazoMeses" className="text-xs">
              Prazo
            </Label>
            <select
              id="prazoMeses"
              name="prazoMeses"
              required
              value={prazoMeses}
              onChange={(evento) => mudou(setPrazoMeses)(evento.target.value)}
              aria-invalid={erroExibido === ERRO_PRAZO_INVALIDO || undefined}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="" disabled>
                Escolha o prazo
              </option>
              <option value="3">3 meses</option>
              <option value="6">6 meses</option>
              <option value="12">12 meses</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
          <CampoDeCarteirinha
            valor={numeroCarteirinha}
            opcional={carteirinhaOpcional}
            invalido={ehErroDaCarteirinha(erroExibido)}
            aoMudar={mudou(setNumeroCarteirinha)}
          />

          <CampoDeCrm
            valor={crmMedico}
            invalido={ehErroDoCrm(erroExibido)}
            aoMudar={mudou(setCrmMedico)}
          />

          <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:min-w-56">
            <Label htmlFor="nomeMedico" className="text-xs">
              Nome do médico
            </Label>
            <Input
              id="nomeMedico"
              name="nomeMedico"
              autoComplete="off"
              maxLength={160}
              className="h-9"
              value={nomeMedico}
              aria-invalid={ehErroDoNomeMedico(erroExibido) ? true : undefined}
              onChange={(evento) => mudou(setNomeMedico)(evento.target.value)}
            />
          </div>

          {/* Espaço da altura do rótulo, para o botão ficar na linha dos campos. */}
          <div className="flex flex-col gap-1.5">
            <span aria-hidden className="hidden text-xs leading-none sm:block">
              &nbsp;
            </span>
            <BotaoDeSubmit />
          </div>
        </div>
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

/** Em componente à parte para o `useFormStatus` enxergar o formulário. */
function BotaoDeSubmit() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className="h-9 sm:mb-0" disabled={pending}>
      {pending ? "Salvando..." : "Registrar encaminhamento"}
    </Button>
  );
}

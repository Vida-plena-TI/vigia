"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import { AvisoDeErroDoEncaminhamento } from "@/components/aviso-de-erro-do-encaminhamento";
import {
  CampoDeCarteirinha,
  CampoDeCrm,
} from "@/components/campos-carteirinha-crm";
import { Button } from "@/components/ui/button";
import { useSituacaoDaCarteirinha } from "@/components/usar-situacao-da-carteirinha";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  criarEncaminhamentoAction,
  type EstadoNovoEncaminhamento,
} from "@/lib/domain/encaminhamentos-actions";
import {
  decidirCarteirinha,
  ehErroDaCarteirinha,
  ehErroDoCrm,
  validarCrm,
} from "@/lib/domain/carteirinha-crm";
import {
  ERRO_DATA_OBRIGATORIA,
  ERRO_PACIENTE_OBRIGATORIO,
  mensagemDeCadastro,
} from "@/lib/domain/encaminhamentos-mensagens";
import type { PacienteParaEncaminhamento } from "@/lib/domain/pacientes";
import { ehErroDoPacienteDoEncaminhamento } from "@/lib/domain/pacientes-mensagens";

import { formatarData } from "../dashboard/formato";

const ESTADO_INICIAL: EstadoNovoEncaminhamento = {};

/**
 * Formulário inline de cadastro de encaminhamento — mora no topo da própria
 * página da listagem, não em rota `/novo` nem em diálogo.
 *
 * O desenho é o de "Lançar atendimento" e "Nova requisição": sucesso **não
 * navega**. A action chama `refresh()`, o Server Component da página redesenha
 * e o registro novo aparece na lista logo abaixo; aqui os campos voltam ao
 * estado inicial e o foco volta para o nome do paciente, porque o uso esperado
 * é cadastrar vários pacientes em sequência rápida.
 *
 * Os campos são controlados por estado do React de propósito: o React 19 limpa
 * os campos não controlados depois que a action roda, o que apagaria o que foi
 * digitado justamente quando a action volta com erro e o usuário precisa
 * corrigir.
 *
 * A validação daqui é conveniência — quem de fato recusa é a Server Action, que
 * é alcançável por POST direto. As duas leem as mesmas mensagens de
 * `lib/domain/encaminhamentos-mensagens.ts` para não divergirem — e, para
 * carteirinha e CRM, as mesmas funções de `lib/domain/carteirinha-crm.ts`.
 *
 * A carteirinha só é obrigatória enquanto o paciente não tem uma (regra 20).
 * O formulário recebe, por nome, apenas *se* existe carteirinha — nunca o
 * número — e com isso marca o campo como opcional. Quem decide de verdade é a
 * transação do servidor, que lê o paciente travado.
 *
 * Desde 29/10/2026 o nome tem de ser de um paciente já cadastrado na Klini
 * (regra 24): o `datalist` traz só esses, e um nome fora dele é recusado pelo
 * servidor — sem criar nada — com o link para a aba Cadastro.
 */
export function FormularioDeEncaminhamento({
  pacientes,
  hoje,
  rotaDoCadastro,
}: {
  /** Só os pacientes da Klini. */
  pacientes: PacienteParaEncaminhamento[];
  /** "AAAA-MM-DD" vinda do `CURRENT_DATE` do banco. */
  hoje: string;
  /** A aba Cadastro da Klini, para o link do erro. */
  rotaDoCadastro: string;
}) {
  const [estado, action] = useActionState(
    criarEncaminhamentoAction,
    ESTADO_INICIAL,
  );

  const campoPacienteRef = useRef<HTMLInputElement>(null);
  const tokenTratado = useRef<string | null>(null);
  const [pacienteNome, setPacienteNome] = useState("");
  // A data começa (e volta) em "hoje", não em vazio: encaminhamento é quase
  // sempre lançado no dia, e um campo de data vazio obrigaria a redigitar o dia
  // inteiro a cada paciente da fila. O "hoje" vem do `CURRENT_DATE` do banco,
  // não do relógio do navegador, pelo mesmo motivo de "Lançar atendimento".
  const [dataEncaminhamento, setDataEncaminhamento] = useState(hoje);
  const [numeroCarteirinha, setNumeroCarteirinha] = useState("");
  const [crmMedico, setCrmMedico] = useState("");
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  const [mensagemDeSucesso, setMensagemDeSucesso] = useState<string | null>(
    null,
  );

  // O erro do cliente só vale até a próxima submissão; depois disso quem manda
  // é a resposta do servidor.
  const erroExibido = erroLocal ?? estado.erro;

  const situacaoDaCarteirinha = useSituacaoDaCarteirinha(
    pacientes,
    pacienteNome,
  );
  const carteirinhaOpcional = situacaoDaCarteirinha === "com-carteirinha";

  useEffect(() => {
    const sucesso = estado.sucesso;

    if (!sucesso || tokenTratado.current === sucesso.token) {
      return;
    }

    tokenTratado.current = sucesso.token;

    // "Atualizado" e "cadastrado" são eventos diferentes: um paciente tem no
    // máximo um encaminhamento, e o segundo cadastro apaga o primeiro. Quem
    // digitou precisa saber qual dos dois aconteceu — a linha antiga some da
    // lista logo abaixo, e sem essa palavra a substituição pareceria um bug.
    const mensagem = mensagemDeCadastro(
      sucesso.pacienteNome,
      sucesso.substituiuAnterior,
    );

    toast.success(mensagem, {
      // A data de vencimento exibida aqui é a que o banco devolveu no
      // `RETURNING` da coluna gerada — não uma soma feita no navegador. No
      // caso da substituição ela é o vencimento **recalculado**: mudar a
      // `data_encaminhamento` faz o Postgres refazer a coluna gerada sozinho.
      description: `Vence em ${formatarData(sucesso.dataVencimento)}.`,
    });

    setMensagemDeSucesso(mensagem);
    setPacienteNome("");
    setDataEncaminhamento(hoje);
    // Carteirinha e CRM voltam vazios como o nome: são do paciente (e do
    // médico dele), e herdá-los no próximo da fila gravaria o dado de um no
    // cadastro do outro sem ninguém perceber.
    setNumeroCarteirinha("");
    setCrmMedico("");
    setErroLocal(null);

    requestAnimationFrame(() => campoPacienteRef.current?.focus());
  }, [estado, hoje]);

  /**
   * Roda antes da action. `preventDefault` cancela a submissão, então um erro
   * daqui nunca chega a virar requisição.
   */
  function validarNoCliente(evento: React.FormEvent<HTMLFormElement>) {
    setMensagemDeSucesso(null);

    if (!pacienteNome.trim()) {
      evento.preventDefault();
      setErroLocal(ERRO_PACIENTE_OBRIGATORIO);
      return;
    }

    if (!dataEncaminhamento.trim()) {
      evento.preventDefault();
      setErroLocal(ERRO_DATA_OBRIGATORIA);
      return;
    }

    // Nome fora da lista ("paciente-novo" na dica) não é checado aqui: o
    // servidor recusa esse nome com a frase certa (não cadastrado, outro
    // convênio ou sem convênio), e cobrar a carteirinha antes a esconderia.
    const carteirinha =
      situacaoDaCarteirinha === "paciente-novo"
        ? ({ ok: true } as const)
        : decidirCarteirinha(numeroCarteirinha, situacaoDaCarteirinha);

    if (!carteirinha.ok) {
      evento.preventDefault();
      setErroLocal(carteirinha.erro);
      return;
    }

    const crm = validarCrm(crmMedico);

    if (!crm.ok) {
      evento.preventDefault();
      setErroLocal(crm.erro);
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
      {/*
        `items-start`, não `items-end`: o texto de apoio da carteirinha deixa a
        coluna dela mais alta, e alinhar pelo pé desceria os outros campos.

        Entre `sm` e `lg` os quatro campos e o botão não cabem numa linha: o
        nome ocupa a linha inteira e o resto quebra embaixo (`flex-wrap`), em
        vez de empurrar a página para o lado.
      */}
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
            aria-invalid={
              erroExibido === ERRO_PACIENTE_OBRIGATORIO ||
              ehErroDoPacienteDoEncaminhamento(erroExibido)
                ? true
                : undefined
            }
            onChange={(evento) => {
              setMensagemDeSucesso(null);
              setPacienteNome(evento.target.value);
            }}
            placeholder="Escolha um paciente cadastrado"
          />
          {/*
            Só os pacientes cadastrados na Klini. O `datalist` sugere; quem
            recusa um nome fora dele é o servidor, que não cria paciente.
          */}
          <datalist id="pacientes-existentes">
            {pacientes.map(({ nome }) => (
              <option key={nome} value={nome} />
            ))}
          </datalist>
        </div>

        <div className="flex flex-col gap-1.5 sm:w-44">
          <Label htmlFor="dataEncaminhamento" className="text-xs">
            Data do encaminhamento
          </Label>
          <Input
            id="dataEncaminhamento"
            name="dataEncaminhamento"
            type="date"
            className="h-9"
            value={dataEncaminhamento}
            onChange={(evento) => {
              setMensagemDeSucesso(null);
              setDataEncaminhamento(evento.target.value);
            }}
          />
        </div>

        <CampoDeCarteirinha
          valor={numeroCarteirinha}
          opcional={carteirinhaOpcional}
          invalido={ehErroDaCarteirinha(erroExibido)}
          aoMudar={(valor) => {
            setMensagemDeSucesso(null);
            setNumeroCarteirinha(valor);
          }}
        />

        <CampoDeCrm
          valor={crmMedico}
          invalido={ehErroDoCrm(erroExibido)}
          aoMudar={(valor) => {
            setMensagemDeSucesso(null);
            setCrmMedico(valor);
          }}
        />

        {/* Espaço da altura do rótulo, para o botão ficar na linha dos campos. */}
        <div className="flex flex-col gap-1.5">
          <span aria-hidden className="hidden text-xs leading-none sm:block">
            &nbsp;
          </span>
          <BotaoDeSubmit />
        </div>
      </div>

      {erroExibido ? (
        <AvisoDeErroDoEncaminhamento
          erro={erroExibido}
          rotaDoCadastro={rotaDoCadastro}
        />
      ) : null}

      {mensagemDeSucesso ? (
        <p role="status" className="text-sm font-medium text-regular">
          {mensagemDeSucesso}
        </p>
      ) : null}
    </form>
  );
}

/**
 * O `useFormStatus` só enxerga o formulário de cima se o botão estiver num
 * componente à parte — por isso ele não é inline no formulário.
 */
function BotaoDeSubmit() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className="h-9 sm:mb-0" disabled={pending}>
      {pending ? "Salvando..." : "Registrar encaminhamento"}
    </Button>
  );
}

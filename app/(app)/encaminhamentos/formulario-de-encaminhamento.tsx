"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  criarEncaminhamentoAction,
  type EstadoNovoEncaminhamento,
} from "@/lib/domain/encaminhamentos-actions";
import {
  ERRO_DATA_OBRIGATORIA,
  ERRO_PACIENTE_OBRIGATORIO,
  mensagemDeCadastro,
} from "@/lib/domain/encaminhamentos-mensagens";

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
 * `lib/domain/encaminhamentos-mensagens.ts` para não divergirem.
 */
export function FormularioDeEncaminhamento({
  nomesDePacientes,
  hoje,
}: {
  nomesDePacientes: string[];
  /** "AAAA-MM-DD" vinda do `CURRENT_DATE` do banco. */
  hoje: string;
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
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  const [mensagemDeSucesso, setMensagemDeSucesso] = useState<string | null>(
    null,
  );

  // O erro do cliente só vale até a próxima submissão; depois disso quem manda
  // é a resposta do servidor.
  const erroExibido = erroLocal ?? estado.erro;

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
          {/*
            Mesmo `datalist` de "Nova requisição": sugere, não restringe.
            Digitar um nome fora da lista continua válido e cria o paciente —
            é o comportamento que o get-or-create do servidor espera.
          */}
          <datalist id="pacientes-existentes">
            {nomesDePacientes.map((nome) => (
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

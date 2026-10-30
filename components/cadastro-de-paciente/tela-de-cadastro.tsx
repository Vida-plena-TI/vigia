"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Convenio } from "@/lib/domain/convenio";
import {
  cadastrarPacienteAction,
  type EstadoCadastroDePaciente,
} from "@/lib/domain/plano-terapias-actions";
import type { PacienteDoConvenio } from "@/lib/domain/plano-terapias";
import {
  ERRO_PACIENTE_OBRIGATORIO,
  ERRO_SEM_TERAPIA,
  ERRO_TERAPIA_OBRIGATORIA,
  ERRO_TERAPIA_REPETIDA,
  mensagemDeCadastro,
} from "@/lib/domain/plano-terapias-mensagens";
import type { TerapiaParaEscolha } from "@/lib/domain/requisicoes";
import {
  lerHorasSemanais,
  minutosParaHorasDigitadas,
} from "@/lib/domain/tempo-semanal";

import { ListaDePacientesDoConvenio } from "./lista-de-pacientes";

const ESTADO_INICIAL: EstadoCadastroDePaciente = {};

/** Uma linha do formulário: os valores como estão nos campos. */
type LinhaDoFormulario = { chave: number; terapiaId: string; horas: string };

/** O erro exibido: a frase e, quando é de uma linha, o índice dela. */
type Erro = { erro: string; linha?: number };

/** Chave estável de cada linha (só para o React), única na página. */
let ultimaChave = 0;

function novaLinha(terapiaId = "", horas = ""): LinhaDoFormulario {
  ultimaChave += 1;
  return { chave: ultimaChave, terapiaId, horas };
}

export const MENSAGEM_PACIENTE_CADASTRADO = "Paciente cadastrado.";
export const MENSAGEM_PLANO_ATUALIZADO = "Plano atualizado.";

/**
 * A aba Cadastro de um convênio: o formulário no topo e a lista dos pacientes
 * do convênio logo abaixo — a única porta de entrada do paciente (regra 24).
 *
 * Formulário e lista moram no mesmo componente porque o "Editar" da lista
 * carrega o paciente **no formulário**: o nome fica travado (o servidor casa
 * o paciente pelo nome) e o envio substitui o plano inteiro.
 *
 * Mesmo desenho dos formulários de encaminhamento: campos controlados (o
 * React 19 limparia os não controlados no erro), sucesso sem navegação
 * (`refresh()` na action redesenha a lista), limpeza e foco no nome. A
 * validação daqui é conveniência, com as mesmas funções puras do domínio; a
 * que vale é a da Server Action.
 *
 * O convênio é o da página e vai num campo escondido: a action o usa para
 * autorizar (a aba Cadastro daquele convênio) e o domínio, para gravar.
 */
export function TelaDeCadastro({
  convenio,
  terapias,
  pacientes,
}: {
  convenio: Convenio;
  terapias: TerapiaParaEscolha[];
  pacientes: PacienteDoConvenio[];
}) {
  const [estado, action] = useActionState(
    cadastrarPacienteAction,
    ESTADO_INICIAL,
  );

  const campoNomeRef = useRef<HTMLInputElement>(null);
  const formularioRef = useRef<HTMLFormElement>(null);
  const tokenTratado = useRef<string | null>(null);

  const [nome, setNome] = useState("");
  const [linhas, setLinhas] = useState<LinhaDoFormulario[]>(() => [
    novaLinha(),
  ]);
  const [emEdicao, setEmEdicao] = useState(false);
  const [erroLocal, setErroLocal] = useState<Erro | null>(null);
  const [mensagemDeSucesso, setMensagemDeSucesso] = useState<string | null>(
    null,
  );

  const erroExibido: Erro | null =
    erroLocal ?? (estado.erro ? { erro: estado.erro, linha: estado.linha } : null);


  useEffect(() => {
    const sucesso = estado.sucesso;

    if (!sucesso || tokenTratado.current === sucesso.token) {
      return;
    }

    tokenTratado.current = sucesso.token;

    toast.success(
      mensagemDeCadastro(sucesso.pacienteNome, sucesso.pacienteCriado),
    );
    setMensagemDeSucesso(
      sucesso.pacienteCriado
        ? MENSAGEM_PACIENTE_CADASTRADO
        : MENSAGEM_PLANO_ATUALIZADO,
    );
    // Volta ao modo de cadastro, vazio: o próximo da fila não herda nada.
    setNome("");
    setLinhas([novaLinha()]);
    setEmEdicao(false);
    setErroLocal(null);

    requestAnimationFrame(() => campoNomeRef.current?.focus());
  }, [estado]);

  function mudou() {
    setMensagemDeSucesso(null);
  }

  function alterarLinha(
    chave: number,
    campo: "terapiaId" | "horas",
    valor: string,
  ) {
    mudou();
    setLinhas((atuais) =>
      atuais.map((linha) =>
        linha.chave === chave ? { ...linha, [campo]: valor } : linha,
      ),
    );
  }

  function adicionarLinha() {
    mudou();
    setLinhas((atuais) => [...atuais, novaLinha()]);
  }

  function removerLinha(chave: number) {
    mudou();
    setErroLocal(null);
    setLinhas((atuais) => atuais.filter((linha) => linha.chave !== chave));
  }

  /** "Editar" da lista: o paciente vai para o formulário, com o nome travado. */
  function editar(paciente: PacienteDoConvenio) {
    setNome(paciente.pacienteNome);
    setLinhas(
      paciente.plano.length > 0
        ? paciente.plano.map((terapia) =>
            novaLinha(
              String(terapia.terapiaId),
              minutosParaHorasDigitadas(terapia.minutosSemanais),
            ),
          )
        : [novaLinha()],
    );
    setEmEdicao(true);
    setErroLocal(null);
    setMensagemDeSucesso(null);

    requestAnimationFrame(() => {
      formularioRef.current?.scrollIntoView({ block: "start" });
      formularioRef.current
        ?.querySelector<HTMLSelectElement>("select")
        ?.focus({ preventScroll: true });
    });
  }

  function cancelarEdicao() {
    setNome("");
    setLinhas([novaLinha()]);
    setEmEdicao(false);
    setErroLocal(null);
    setMensagemDeSucesso(null);
    requestAnimationFrame(() => campoNomeRef.current?.focus());
  }

  /**
   * "Excluir" da lista concluído: se o formulário estava editando esse
   * paciente, sai da edição — o envio recriaria o paciente que acabou de ser
   * apagado.
   */
  function excluido(paciente: PacienteDoConvenio) {
    if (emEdicao && nome === paciente.pacienteNome) {
      cancelarEdicao();
    }
  }

  /** Na ordem dos campos; `preventDefault` cancela a submissão. */
  function validarNoCliente(evento: React.FormEvent<HTMLFormElement>) {
    setMensagemDeSucesso(null);

    const erro = validarFormulario(nome, linhas);

    if (erro) {
      evento.preventDefault();
      setErroLocal(erro);
      return;
    }

    setErroLocal(null);
  }

  // Quem já está na lista: em modo de cadastro, digitar o nome dele substitui
  // o plano (o domínio casa pelo nome). A dica avisa antes do envio.
  const nomeJaNaLista =
    !emEdicao &&
    nome.trim() !== "" &&
    pacientes.some(
      (paciente) =>
        paciente.pacienteNome.toLowerCase() === nome.trim().toLowerCase(),
    );

  const escolhidas = new Set(
    linhas.map((linha) => linha.terapiaId).filter(Boolean),
  );

  return (
    <>
      <section className="flex flex-col gap-4">
        <h2 className="regua-de-secao">
          {emEdicao ? "Editar plano" : "Novo paciente"}
        </h2>

        <form
          ref={formularioRef}
          action={action}
          onSubmit={validarNoCliente}
          noValidate
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="convenio" value={convenio} />

          <div className="flex flex-col gap-1.5 sm:max-w-md">
            <Label htmlFor="nome" className="text-xs">
              Nome do paciente
            </Label>
            <Input
              ref={campoNomeRef}
              id="nome"
              name="nome"
              autoComplete="off"
              className="h-9"
              value={nome}
              readOnly={emEdicao}
              aria-describedby={emEdicao || nomeJaNaLista ? "nome-apoio" : undefined}
              aria-invalid={
                erroExibido?.erro === ERRO_PACIENTE_OBRIGATORIO ? true : undefined
              }
              onChange={(evento) => {
                mudou();
                setNome(evento.target.value);
              }}
            />
            {emEdicao ? (
              <p id="nome-apoio" className="text-xs text-muted-foreground">
                O nome não muda na edição. Salvar substitui o plano inteiro.
              </p>
            ) : nomeJaNaLista ? (
              <p id="nome-apoio" className="text-xs text-muted-foreground">
                Este paciente já está na lista abaixo. Cadastrar de novo
                substitui o plano dele.
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <div className="folha divide-y divide-regua overflow-hidden">
              {linhas.map((linha, indice) => (
                <LinhaDoPlano
                  key={linha.chave}
                  linha={linha}
                  indice={indice}
                  terapias={terapias}
                  escolhidas={escolhidas}
                  podeRemover={linhas.length > 1}
                  temErro={erroExibido?.linha === indice}
                  aoAlterar={alterarLinha}
                  aoRemover={removerLinha}
                />
              ))}
            </div>

            <p id="horas-apoio" className="text-xs text-muted-foreground">
              Digite em horas, por exemplo 2 ou 2,5.
            </p>

            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                // Cada terapia entra uma vez só: com todas escolhidas, uma
                // linha nova não teria o que escolher.
                disabled={linhas.length >= terapias.length}
                onClick={adicionarLinha}
              >
                Adicionar terapia
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <BotaoDeSubmit emEdicao={emEdicao} />
            {emEdicao ? (
              <Button type="button" variant="ghost" onClick={cancelarEdicao}>
                Cancelar edição
              </Button>
            ) : null}
          </div>

          {erroExibido ? (
            <p role="alert" className="aviso-de-erro">
              {erroExibido.erro}
            </p>
          ) : null}

          {mensagemDeSucesso ? (
            <p role="status" className="text-sm font-medium text-regular">
              {mensagemDeSucesso}
            </p>
          ) : null}
        </form>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="regua-de-secao">
          Pacientes
          <span className="text-sm font-normal text-muted-foreground">
            {pacientes.length}
          </span>
        </h2>

        <ListaDePacientesDoConvenio
          convenio={convenio}
          pacientes={pacientes}
          aoEditar={editar}
          aoExcluir={excluido}
        />
      </section>
    </>
  );
}

/**
 * A validação do cliente, na ordem dos campos — as mesmas regras de
 * `validarEntrada` em `lib/domain/plano-terapias.ts`, que é a que vale.
 */
function validarFormulario(
  nome: string,
  linhas: readonly LinhaDoFormulario[],
): Erro | null {
  if (!nome.trim()) {
    return { erro: ERRO_PACIENTE_OBRIGATORIO };
  }

  if (linhas.length === 0) {
    return { erro: ERRO_SEM_TERAPIA };
  }

  const vistas = new Set<string>();

  for (const [indice, linha] of linhas.entries()) {
    if (!linha.terapiaId) {
      return { erro: ERRO_TERAPIA_OBRIGATORIA, linha: indice };
    }

    if (vistas.has(linha.terapiaId)) {
      return { erro: ERRO_TERAPIA_REPETIDA, linha: indice };
    }

    vistas.add(linha.terapiaId);

    const tempo = lerHorasSemanais(linha.horas);

    if (!tempo.ok) {
      return { erro: tempo.erro, linha: indice };
    }
  }

  return null;
}

/** Classes do `Input`, para o `select` nativo não destoar (o de "Nova requisição"). */
const CLASSES_DO_SELECT =
  "h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30";

/**
 * Uma linha "terapia + horas por semana".
 *
 * Os dois campos têm o mesmo `name` em todas as linhas (`terapiaId`,
 * `horas`); a action lê com `getAll` e costura por índice, na ordem do DOM —
 * o desenho de "Nova requisição", inclusive no `select` nativo e no filete
 * de margem da linha com erro.
 *
 * A terapia já escolhida em outra linha aparece desabilitada: na tela não dá
 * para repetir. O servidor continua recusando a repetição (POST montado à mão).
 */
function LinhaDoPlano({
  linha,
  indice,
  terapias,
  escolhidas,
  podeRemover,
  temErro,
  aoAlterar,
  aoRemover,
}: {
  linha: LinhaDoFormulario;
  indice: number;
  terapias: TerapiaParaEscolha[];
  escolhidas: ReadonlySet<string>;
  podeRemover: boolean;
  temErro: boolean;
  aoAlterar: (chave: number, campo: "terapiaId" | "horas", valor: string) => void;
  aoRemover: (chave: number) => void;
}) {
  const idTerapia = `plano-terapia-${linha.chave}`;
  const idHoras = `plano-horas-${linha.chave}`;

  return (
    <div
      className={`flex flex-col gap-3 border-l-[3px] px-3 py-3 sm:flex-row sm:items-end ${
        temErro ? "border-l-esgotada bg-esgotada-fundo/50" : "border-l-transparent"
      }`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Label htmlFor={idTerapia} className="text-xs">
          Terapia {indice + 1}
        </Label>
        <select
          id={idTerapia}
          name="terapiaId"
          className={CLASSES_DO_SELECT}
          value={linha.terapiaId}
          aria-invalid={temErro ? true : undefined}
          onChange={(evento) =>
            aoAlterar(linha.chave, "terapiaId", evento.target.value)
          }
        >
          <option value="">Escolha uma terapia</option>
          {terapias.map((terapia) => {
            const valor = String(terapia.id);

            return (
              <option
                key={terapia.id}
                value={valor}
                disabled={valor !== linha.terapiaId && escolhidas.has(valor)}
              >
                {terapia.nome}
              </option>
            );
          })}
        </select>
      </div>

      <div className="flex flex-col gap-1.5 sm:w-44">
        <Label htmlFor={idHoras} className="text-xs">
          Tempo por semana (horas)
        </Label>
        <Input
          id={idHoras}
          name="horas"
          inputMode="decimal"
          autoComplete="off"
          className="h-9 text-right"
          value={linha.horas}
          aria-describedby="horas-apoio"
          aria-invalid={temErro ? true : undefined}
          onChange={(evento) =>
            aoAlterar(linha.chave, "horas", evento.target.value)
          }
        />
      </div>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start sm:mb-0.5 sm:self-auto"
        // A última linha não sai: o plano precisa de pelo menos uma terapia.
        disabled={!podeRemover}
        aria-label={`Remover terapia ${indice + 1}`}
        onClick={() => aoRemover(linha.chave)}
      >
        Remover
      </Button>
    </div>
  );
}

/** Em componente à parte para o `useFormStatus` enxergar o formulário. */
function BotaoDeSubmit({ emEdicao }: { emEdicao: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className="h-9" disabled={pending}>
      {pending ? "Salvando..." : emEdicao ? "Salvar plano" : "Cadastrar paciente"}
    </Button>
  );
}

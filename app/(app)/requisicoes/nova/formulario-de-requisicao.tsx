"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  criarRequisicaoAction,
  type EstadoNovaRequisicao,
} from "@/lib/domain/requisicoes-actions";
import {
  ERRO_QTD_INVALIDA,
  ERRO_SEM_TERAPIA,
  ERRO_TERAPIA_OBRIGATORIA,
} from "@/lib/domain/requisicoes-mensagens";
import type { TerapiaParaEscolha } from "@/lib/domain/requisicoes";

const ESTADO_INICIAL: EstadoNovaRequisicao = {};

/**
 * Uma linha do formulário.
 *
 * Os valores ficam como texto porque é isso que um `input` produz — converter
 * para número aqui só criaria um segundo lugar onde `"3.7"` ou `""` viram algo
 * plausível e errado. A conversão acontece de uma vez só no servidor.
 *
 * `chave` é um contador local, não o índice do array: usar o índice como
 * `key` faria o React reaproveitar o DOM da linha errada ao remover uma linha
 * do meio, e o texto digitado escorregaria para a linha de baixo.
 */
type LinhaDoFormulario = {
  chave: number;
  terapiaId: string;
  qtdAutorizada: string;
  validade: string;
};

function linhaVazia(chave: number): LinhaDoFormulario {
  return { chave, terapiaId: "", qtdAutorizada: "", validade: "" };
}

/**
 * Cadastro de nova requisição.
 *
 * Os campos são controlados por estado do React de propósito. React 19 limpa
 * os campos não controlados de um formulário depois que a action roda — o que
 * apagaria tudo que o usuário digitou justamente quando a action volta com
 * erro e ele precisa corrigir uma linha.
 *
 * A validação daqui é conveniência: evita um ida-e-volta ao servidor para um
 * erro óbvio. Quem de fato recusa é a Server Action, que é alcançável por POST
 * direto — as duas usam as mesmas mensagens de
 * `lib/domain/requisicoes-mensagens.ts` para não divergirem.
 *
 * Visualmente é um formulário em etapas numeradas, separadas por régua
 * rotulada — não uma pilha de cartões. Cartão sugere "objeto independente";
 * aqui são dois passos de um mesmo preenchimento, e a numeração diz a ordem.
 */
export function FormularioDeRequisicao({
  nomesDePacientes,
  terapias,
}: {
  nomesDePacientes: string[];
  terapias: TerapiaParaEscolha[];
}) {
  const [estado, action] = useActionState(
    criarRequisicaoAction,
    ESTADO_INICIAL,
  );

  const proximaChave = useRef(1);
  const campoPacienteRef = useRef<HTMLInputElement>(null);
  const tokenTratado = useRef<string | null>(null);
  const [pacienteNome, setPacienteNome] = useState("");
  const [numeroRequisicao, setNumeroRequisicao] = useState("");
  const [linhas, setLinhas] = useState<LinhaDoFormulario[]>(() => [
    linhaVazia(0),
  ]);
  const [erroLocal, setErroLocal] = useState<EstadoNovaRequisicao | null>(null);
  const [mensagemDeSucesso, setMensagemDeSucesso] = useState<string | null>(
    null,
  );

  // O erro do cliente só vale até a próxima submissão; depois disso quem manda
  // é a resposta do servidor.
  const erroExibido = erroLocal ?? estado;

  // Limpeza pós-sucesso: sem navegar para o dashboard, o formulário volta ao
  // início ali mesmo para cadastrar a próxima requisição. O token evita limpar
  // duas vezes no StrictMode e transforma sucessos iguais em eventos distintos.
  useEffect(() => {
    const sucesso = estado.sucesso;

    if (!sucesso || tokenTratado.current === sucesso.token) {
      return;
    }

    tokenTratado.current = sucesso.token;

    const mensagem = `Requisição criada para ${sucesso.pacienteNome}.`;

    toast.success(mensagem, {
      description: `Número ${sucesso.numeroRequisicao}.`,
    });

    setMensagemDeSucesso(mensagem);
    setPacienteNome("");
    setNumeroRequisicao("");
    setLinhas([linhaVazia(proximaChave.current++)]);
    setErroLocal(null);

    requestAnimationFrame(() => campoPacienteRef.current?.focus());
  }, [estado]);

  function adicionarLinha() {
    setMensagemDeSucesso(null);
    setLinhas((atuais) => [...atuais, linhaVazia(proximaChave.current++)]);
  }

  function removerLinha(chave: number) {
    setMensagemDeSucesso(null);
    setLinhas((atuais) => atuais.filter((linha) => linha.chave !== chave));
  }

  function alterarLinha(
    chave: number,
    campo: keyof Omit<LinhaDoFormulario, "chave">,
    valor: string,
  ) {
    setMensagemDeSucesso(null);
    setLinhas((atuais) =>
      atuais.map((linha) =>
        linha.chave === chave ? { ...linha, [campo]: valor } : linha,
      ),
    );
  }

  /**
   * Roda antes da action. `preventDefault` cancela a submissão, então um erro
   * daqui nunca chega a virar requisição.
   */
  function validarNoCliente(evento: React.FormEvent<HTMLFormElement>) {
    setMensagemDeSucesso(null);

    if (linhas.length === 0) {
      evento.preventDefault();
      setErroLocal({ erro: ERRO_SEM_TERAPIA });
      return;
    }

    for (const [indice, linha] of linhas.entries()) {
      if (!linha.terapiaId) {
        evento.preventDefault();
        setErroLocal({ erro: ERRO_TERAPIA_OBRIGATORIA, linha: indice });
        return;
      }

      const quantidade = Number(linha.qtdAutorizada);

      if (!Number.isInteger(quantidade) || quantidade <= 0) {
        evento.preventDefault();
        setErroLocal({ erro: ERRO_QTD_INVALIDA, linha: indice });
        return;
      }
    }

    setErroLocal(null);
  }

  return (
    <form
      action={action}
      onSubmit={validarNoCliente}
      noValidate
      className="flex flex-col gap-8"
    >
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="regua-de-secao">1. Paciente e requisição</h2>
          <p className="max-w-prose text-xs text-muted-foreground">
            Se o paciente ainda não existe, ele é criado junto. A comparação
            ignora maiúsculas e minúsculas: &quot;José Silva&quot; e
            &quot;JOSÉ SILVA&quot; são a mesma pessoa.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pacienteNome" className="text-xs">
              Nome do paciente
            </Label>
            <Input
              ref={campoPacienteRef}
              id="pacienteNome"
              name="pacienteNome"
              list="pacientes-existentes"
              autoComplete="off"
              autoFocus
              className="h-9"
              value={pacienteNome}
              onChange={(evento) => {
                setMensagemDeSucesso(null);
                setPacienteNome(evento.target.value);
              }}
              placeholder="Digite ou escolha um paciente"
            />
            {/*
              `datalist` sugere, não restringe: digitar um nome fora da lista
              continua válido e cria o paciente. É o comportamento que o
              get-or-create do servidor espera.
            */}
            <datalist id="pacientes-existentes">
              {nomesDePacientes.map((nome) => (
                <option key={nome} value={nome} />
              ))}
            </datalist>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="numeroRequisicao" className="text-xs">
              Número da requisição
            </Label>
            <Input
              id="numeroRequisicao"
              name="numeroRequisicao"
              autoComplete="off"
              className="h-9"
              value={numeroRequisicao}
              onChange={(evento) => {
                setMensagemDeSucesso(null);
                setNumeroRequisicao(evento.target.value);
              }}
              placeholder="Ex.: 2026-00187"
            />
            <p className="text-xs text-muted-foreground">
              Precisa ser único para este paciente. O mesmo número pode se
              repetir em pacientes diferentes.
            </p>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="regua-de-secao">2. Terapias autorizadas</h2>
          <p className="max-w-prose text-xs text-muted-foreground">
            Uma linha por terapia. A validade é opcional.
          </p>
        </div>

        <div className="folha divide-y divide-regua overflow-hidden">
          {linhas.map((linha, indice) => (
            <LinhaDeTerapiaDoFormulario
              key={linha.chave}
              linha={linha}
              indice={indice}
              terapias={terapias}
              podeRemover={linhas.length > 1}
              temErro={erroExibido.linha === indice}
              aoAlterar={alterarLinha}
              aoRemover={removerLinha}
            />
          ))}
        </div>

        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={adicionarLinha}
          >
            Adicionar outra terapia
          </Button>
        </div>
      </section>

      {erroExibido.erro ? (
        <p role="alert" className="aviso-de-erro">
          {erroExibido.erro}
        </p>
      ) : null}

      {mensagemDeSucesso ? (
        <p role="status" className="text-sm font-medium text-regular">
          {mensagemDeSucesso}
        </p>
      ) : null}

      <div className="flex items-center gap-3 border-t border-regua-forte pt-5">
        <BotaoDeSubmit />
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard">Cancelar</Link>
        </Button>
      </div>
    </form>
  );
}

function BotaoDeSubmit() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="lg" disabled={pending}>
      {pending ? "Salvando..." : "Criar requisição"}
    </Button>
  );
}

/** Classes do `Input`, para o `select` nativo não destoar dos outros campos. */
const CLASSES_DO_SELECT =
  "h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30";

/**
 * Uma linha "terapia + quantidade + validade".
 *
 * Os três campos são enviados com o mesmo `name` em todas as linhas
 * (`terapiaId`, `qtdAutorizada`, `validade`); o servidor lê os vetores com
 * `formData.getAll` e os costura por índice, na ordem do DOM.
 *
 * O `select` é nativo, não o do shadcn/ui: o do Radix injeta um `select`
 * escondido para participar do formulário, e aqui há um por linha — o campo
 * nativo é o que o `getAll` enxerga de forma previsível, e continua funcionando
 * sem JavaScript.
 *
 * A linha com erro ganha o mesmo filete de margem carmim das guias esgotadas
 * do painel: é o canal que faz o erro ser achado pela borda, sem leitura.
 */
function LinhaDeTerapiaDoFormulario({
  linha,
  indice,
  terapias,
  podeRemover,
  temErro,
  aoAlterar,
  aoRemover,
}: {
  linha: LinhaDoFormulario;
  indice: number;
  terapias: TerapiaParaEscolha[];
  podeRemover: boolean;
  temErro: boolean;
  aoAlterar: (
    chave: number,
    campo: keyof Omit<LinhaDoFormulario, "chave">,
    valor: string,
  ) => void;
  aoRemover: (chave: number) => void;
}) {
  const idTerapia = `terapia-${linha.chave}`;
  const idQuantidade = `quantidade-${linha.chave}`;
  const idValidade = `validade-${linha.chave}`;

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
          {terapias.map((terapia) => (
            <option key={terapia.id} value={terapia.id}>
              {terapia.nome} ({terapia.codigoTiss})
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5 sm:w-28">
        <Label htmlFor={idQuantidade} className="text-xs">
          Qtd. autorizada
        </Label>
        <Input
          id={idQuantidade}
          name="qtdAutorizada"
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          className="h-9 text-right"
          value={linha.qtdAutorizada}
          aria-invalid={temErro ? true : undefined}
          onChange={(evento) =>
            aoAlterar(linha.chave, "qtdAutorizada", evento.target.value)
          }
        />
      </div>

      <div className="flex flex-col gap-1.5 sm:w-40">
        <Label htmlFor={idValidade} className="text-xs">
          Validade (opcional)
        </Label>
        <Input
          id={idValidade}
          name="validade"
          type="date"
          className="h-9"
          value={linha.validade}
          onChange={(evento) =>
            aoAlterar(linha.chave, "validade", evento.target.value)
          }
        />
      </div>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="sm:mb-0.5"
        // A última linha não pode sair: a requisição precisa de pelo menos uma
        // terapia, e um formulário sem nenhuma linha não teria como voltar.
        disabled={!podeRemover}
        onClick={() => aoRemover(linha.chave)}
      >
        Remover
      </Button>
    </div>
  );
}

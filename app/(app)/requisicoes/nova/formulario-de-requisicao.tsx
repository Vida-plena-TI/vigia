"use client";

import { useActionState, useRef, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
 */
export function FormularioDeRequisicao({
  nomesDePacientes,
  terapias,
}: {
  nomesDePacientes: string[];
  terapias: TerapiaParaEscolha[];
}) {
  const [estado, action, enviando] = useActionState(
    criarRequisicaoAction,
    ESTADO_INICIAL,
  );

  const proximaChave = useRef(1);
  const [pacienteNome, setPacienteNome] = useState("");
  const [numeroRequisicao, setNumeroRequisicao] = useState("");
  const [linhas, setLinhas] = useState<LinhaDoFormulario[]>(() => [
    linhaVazia(0),
  ]);
  const [erroLocal, setErroLocal] = useState<EstadoNovaRequisicao | null>(null);

  // O erro do cliente só vale até a próxima submissão; depois disso quem manda
  // é a resposta do servidor.
  const erroExibido = erroLocal ?? estado;

  function adicionarLinha() {
    setLinhas((atuais) => [...atuais, linhaVazia(proximaChave.current++)]);
  }

  function removerLinha(chave: number) {
    setLinhas((atuais) => atuais.filter((linha) => linha.chave !== chave));
  }

  function alterarLinha(
    chave: number,
    campo: keyof Omit<LinhaDoFormulario, "chave">,
    valor: string,
  ) {
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
      className="flex flex-col gap-6"
    >
      <Card>
        <CardHeader>
          <CardTitle>Paciente e requisição</CardTitle>
          <CardDescription>
            Se o paciente ainda não existe, ele é criado junto. A comparação
            ignora maiúsculas e minúsculas — &quot;José Silva&quot; e
            &quot;JOSÉ SILVA&quot; são a mesma pessoa.
          </CardDescription>
        </CardHeader>

        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="pacienteNome">Nome do paciente</Label>
            <Input
              id="pacienteNome"
              name="pacienteNome"
              list="pacientes-existentes"
              autoComplete="off"
              autoFocus
              value={pacienteNome}
              onChange={(evento) => setPacienteNome(evento.target.value)}
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

          <div className="flex flex-col gap-2">
            <Label htmlFor="numeroRequisicao">Número da requisição</Label>
            <Input
              id="numeroRequisicao"
              name="numeroRequisicao"
              autoComplete="off"
              value={numeroRequisicao}
              onChange={(evento) => setNumeroRequisicao(evento.target.value)}
              placeholder="Ex.: 2026-00187"
            />
            <p className="text-xs text-muted-foreground">
              Precisa ser único para este paciente. O mesmo número pode se
              repetir em pacientes diferentes.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Terapias autorizadas</CardTitle>
          <CardDescription>
            Uma linha por terapia. A validade é opcional.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
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
        </CardContent>
      </Card>

      {erroExibido.erro ? (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {erroExibido.erro}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={enviando}>
          {enviando ? "Salvando..." : "Criar requisição"}
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard">Cancelar</Link>
        </Button>
      </div>
    </form>
  );
}

/** Classes do `Input`, para o `select` nativo não destoar dos outros campos. */
const CLASSES_DO_SELECT =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30";

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
    <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-end">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Label htmlFor={idTerapia}>Terapia {indice + 1}</Label>
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

      <div className="flex flex-col gap-2 sm:w-32">
        <Label htmlFor={idQuantidade}>Qtd. autorizada</Label>
        <Input
          id={idQuantidade}
          name="qtdAutorizada"
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          value={linha.qtdAutorizada}
          aria-invalid={temErro ? true : undefined}
          onChange={(evento) =>
            aoAlterar(linha.chave, "qtdAutorizada", evento.target.value)
          }
        />
      </div>

      <div className="flex flex-col gap-2 sm:w-44">
        <Label htmlFor={idValidade}>Validade (opcional)</Label>
        <Input
          id={idValidade}
          name="validade"
          type="date"
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

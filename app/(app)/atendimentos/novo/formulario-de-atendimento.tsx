"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  carregarGuiasDoPaciente,
  lancarAtendimentos,
  type EstadoDoLancamento,
} from "@/lib/domain/atendimentos-actions";
import type {
  GuiaDisponivel,
  PacienteParaEscolha,
} from "@/lib/domain/atendimentos";
import {
  ERRO_CREDITOS_INVALIDOS,
  ERRO_PACIENTE_OBRIGATORIO,
  ERRO_SEM_SELECAO,
  erroSaldoInsuficiente,
} from "@/lib/domain/atendimentos-mensagens";

import { formatarData, MARCADOR_POR_STATUS } from "../../dashboard/formato";
import { StatusBadge } from "../../dashboard/status-badge";

const ESTADO_INICIAL: EstadoDoLancamento = {};

/** Créditos que uma terapia recém-marcada consome, até o usuário mudar. */
const CREDITOS_PADRAO = "1";

/** O que o usuário marcou em cada guia. */
type Selecao = {
  marcada: boolean;
  /** Texto, porque é o que um `input` produz. A conversão é no servidor. */
  creditos: string;
};

/** Classes do `Input`, para o `select` e o `textarea` não destoarem. */
const CLASSES_DO_CAMPO =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30";

/**
 * Lançamento de atendimento em lote.
 *
 * Os campos são controlados por estado do React de propósito, pelo mesmo
 * motivo do formulário de requisição: o React 19 limpa os campos não
 * controlados depois que a action roda, o que apagaria a seleção justamente
 * quando a action volta com erro e o usuário precisa corrigir uma linha. Aqui
 * há um segundo motivo — no sucesso somos *nós* que decidimos o que limpar.
 *
 * A validação daqui é conveniência: evita um ida-e-volta ao servidor por um
 * erro óbvio. Quem de fato recusa é a Server Action, que é alcançável por POST
 * direto — as duas usam as mensagens de
 * `lib/domain/atendimentos-mensagens.ts` para não divergirem.
 *
 * Etapas numeradas separadas por régua, como o cadastro de requisição: as duas
 * telas de formulário do sistema têm a mesma estrutura, e nenhuma delas é uma
 * pilha de cartões.
 */
export function FormularioDeAtendimento({
  pacientes,
  hoje,
}: {
  pacientes: PacienteParaEscolha[];
  hoje: string;
}) {
  const [estado, action, enviando] = useActionState(
    lancarAtendimentos,
    ESTADO_INICIAL,
  );

  const [pacienteId, setPacienteId] = useState("");
  // A data sobrevive à limpeza pós-sucesso: quem lança o dia inteiro de
  // atendimentos não quer redigitar a mesma data a cada paciente.
  const [dataAtendimento, setDataAtendimento] = useState(hoje);
  const [observacao, setObservacao] = useState("");
  const [guias, setGuias] = useState<GuiaDisponivel[] | null>(null);
  const [selecoes, setSelecoes] = useState<Record<number, Selecao>>({});
  const [erroLocal, setErroLocal] = useState<EstadoDoLancamento | null>(null);
  const [erroDeCarga, setErroDeCarga] = useState<string | null>(null);
  const [carregando, iniciarCarga] = useTransition();

  // O erro do cliente só vale até a próxima submissão; depois disso quem manda
  // é a resposta do servidor.
  const erroExibido = erroLocal ?? estado;

  const marcadas = (guias ?? []).filter((guia) => selecoes[guia.id]?.marcada);
  const pacienteEscolhido = pacientes.find(
    (paciente) => String(paciente.id) === pacienteId,
  );

  // "Marcar todas" é derivado das seleções individuais, não um estado à parte.
  // É isso que o faz cair para indeterminado quando o usuário desmarca uma
  // linha na mão depois de usar o mestre — e voltar sozinho ao vazio quando
  // `selecoes` é limpo (troca de paciente, limpeza pós-sucesso), sem precisar
  // lembrar de resetar um segundo estado que ficaria obsoleto.
  const totalDeGuias = guias?.length ?? 0;
  const todasMarcadas = totalDeGuias > 0 && marcadas.length === totalDeGuias;
  const parcialmenteMarcadas =
    marcadas.length > 0 && marcadas.length < totalDeGuias;

  const refMarcarTodas = useRef<HTMLInputElement>(null);
  const tokenTratado = useRef<string | null>(null);

  // `indeterminate` existe só como propriedade do DOM: não há atributo HTML nem
  // prop do React para ele, então é este efeito que mantém o desenho do
  // checkbox de acordo com o estado derivado acima. O `aria-checked="mixed"` do
  // JSX é o outro lado disso, para quem ouve a tela em vez de olhar.
  useEffect(() => {
    if (refMarcarTodas.current) {
      refMarcarTodas.current.indeterminate = parcialmenteMarcadas;
    }
  }, [parcialmenteMarcadas]);

  // Limpeza pós-sucesso (item 4 do Prompt 6): sem navegar para o dashboard, o
  // formulário volta ao início ali mesmo para o próximo lançamento. O token
  // evita repetir a limpeza quando o efeito roda de novo (StrictMode) e faz
  // dois lotes de números idênticos serem tratados como eventos diferentes.
  useEffect(() => {
    const sucesso = estado.sucesso;

    if (!sucesso || tokenTratado.current === sucesso.token) {
      return;
    }

    tokenTratado.current = sucesso.token;

    toast.success(
      `${sucesso.totalDeAtendimentos} atendimento(s) lançado(s)${
        sucesso.pacienteNome ? ` para ${sucesso.pacienteNome}` : ""
      }.`,
      {
        description: `${sucesso.totalDeCreditos} crédito(s) consumido(s). Pode lançar o próximo.`,
      },
    );

    setPacienteId("");
    setGuias(null);
    setSelecoes({});
    setObservacao("");
    setErroLocal(null);
    setErroDeCarga(null);
  }, [estado]);

  /** Troca de paciente: as guias antigas não valem mais nada. */
  function escolherPaciente(proximoId: string) {
    setPacienteId(proximoId);
    setGuias(null);
    setSelecoes({});
    setErroLocal(null);
    setErroDeCarga(null);

    const id = Number(proximoId);

    if (!proximoId || !Number.isInteger(id)) {
      return;
    }

    iniciarCarga(async () => {
      try {
        setGuias(await carregarGuiasDoPaciente(id));
      } catch {
        setErroDeCarga("Não foi possível carregar as terapias deste paciente.");
      }
    });
  }

  function alternarGuia(guiaId: number, marcada: boolean) {
    setSelecoes((atuais) => ({
      ...atuais,
      [guiaId]: {
        marcada,
        creditos: atuais[guiaId]?.creditos ?? CREDITOS_PADRAO,
      },
    }));
  }

  /**
   * Marca ou desmarca de uma vez todas as guias com saldo do paciente.
   *
   * Ao marcar, o crédito que o usuário já tinha digitado numa linha é
   * preservado — só quem não tinha valor nenhum recebe o padrão. Ao desmarcar,
   * os valores continuam guardados, exatamente como já acontece ao desmarcar
   * uma linha sozinha.
   */
  function alternarTodas(marcada: boolean) {
    setSelecoes((atuais) => {
      const proximas: Record<number, Selecao> = { ...atuais };

      for (const guia of guias ?? []) {
        proximas[guia.id] = {
          marcada,
          creditos: atuais[guia.id]?.creditos ?? CREDITOS_PADRAO,
        };
      }

      return proximas;
    });
  }

  function alterarCreditos(guiaId: number, creditos: string) {
    setSelecoes((atuais) => ({
      ...atuais,
      [guiaId]: { marcada: atuais[guiaId]?.marcada ?? true, creditos },
    }));
  }

  /**
   * Roda antes da action. `preventDefault` cancela a submissão, então um erro
   * daqui nunca chega a virar requisição.
   *
   * O índice do erro é a posição dentro de `marcadas` — a mesma numeração que
   * a Server Action devolve, porque é essa a ordem em que os campos são
   * enviados.
   */
  function validarNoCliente(evento: React.FormEvent<HTMLFormElement>) {
    if (!pacienteId) {
      evento.preventDefault();
      setErroLocal({ erro: ERRO_PACIENTE_OBRIGATORIO });
      return;
    }

    if (marcadas.length === 0) {
      evento.preventDefault();
      setErroLocal({ erro: ERRO_SEM_SELECAO });
      return;
    }

    for (const [indice, guia] of marcadas.entries()) {
      const texto = selecoes[guia.id]?.creditos ?? "";
      const creditos = /^-?\d+$/.test(texto.trim()) ? Number(texto) : Number.NaN;

      if (!Number.isInteger(creditos) || creditos <= 0) {
        evento.preventDefault();
        setErroLocal({ erro: ERRO_CREDITOS_INVALIDOS, item: indice });
        return;
      }

      // O saldo aqui é o que a página carregou; ele pode ter mudado desde
      // então. Avisar cedo é conforto — quem decide de verdade é a transação
      // com `FOR UPDATE`, com o saldo lido no instante do lançamento.
      if (creditos > guia.saldoRestante) {
        evento.preventDefault();
        setErroLocal({
          erro: erroSaldoInsuficiente(
            guia.terapiaNome,
            guia.saldoRestante,
            creditos,
          ),
          item: indice,
        });
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
      {/*
        O nome viaja junto só para a mensagem de sucesso poder dizer de quem
        era o lote depois que o `select` já foi limpo. Nenhuma decisão do
        servidor depende dele.
      */}
      <input
        type="hidden"
        name="pacienteNome"
        value={pacienteEscolhido?.nome ?? ""}
      />

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="regua-de-secao">1. Paciente e data</h2>
          <p className="max-w-prose text-xs text-muted-foreground">
            Só aparecem pacientes com pelo menos uma guia com saldo.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pacienteId" className="text-xs">
              Paciente
            </Label>
            {/*
              `select` nativo, não o do shadcn/ui, pelo mesmo motivo do
              formulário de requisição: o do Radix injeta um campo escondido
              para participar do formulário, e o nativo é o que o `FormData`
              enxerga de forma previsível.
            */}
            <select
              id="pacienteId"
              name="pacienteId"
              className={`h-9 ${CLASSES_DO_CAMPO}`}
              value={pacienteId}
              autoFocus
              aria-invalid={
                erroExibido.erro === ERRO_PACIENTE_OBRIGATORIO ? true : undefined
              }
              onChange={(evento) => escolherPaciente(evento.target.value)}
            >
              <option value="">Escolha um paciente</option>
              {pacientes.map((paciente) => (
                <option key={paciente.id} value={paciente.id}>
                  {paciente.nome}
                </option>
              ))}
            </select>
            {pacientes.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhum paciente tem guia com saldo. Cadastre uma requisição
                antes de lançar atendimentos.
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dataAtendimento" className="text-xs">
              Data do atendimento
            </Label>
            <Input
              id="dataAtendimento"
              name="dataAtendimento"
              type="date"
              className="h-9"
              value={dataAtendimento}
              onChange={(evento) => setDataAtendimento(evento.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Começa em hoje ({formatarData(hoje)}) e continua igual entre um
              lançamento e o próximo.
            </p>
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="observacao" className="text-xs">
              Observação (opcional)
            </Label>
            {/*
              `textarea` nativo com as classes do `Input`: o projeto não tem o
              componente do shadcn/ui instalado, e um campo de texto livre não
              justifica trazer outro arquivo do registry.
            */}
            <textarea
              id="observacao"
              name="observacao"
              rows={2}
              className={`min-h-16 py-2 ${CLASSES_DO_CAMPO}`}
              value={observacao}
              onChange={(evento) => setObservacao(evento.target.value)}
              placeholder="Vale para todos os atendimentos deste lote."
            />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="regua-de-secao">2. Terapias atendidas</h2>
          <p className="max-w-prose text-xs text-muted-foreground">
            Marque as terapias atendidas e ajuste os créditos de cada uma.
          </p>
        </div>

        {!pacienteId ? (
          <p className="folha px-4 py-6 text-center text-sm text-muted-foreground">
            Escolha um paciente para ver as terapias com saldo.
          </p>
        ) : null}

        {carregando ? (
          <p className="folha px-4 py-6 text-center text-sm text-muted-foreground">
            Carregando...
          </p>
        ) : null}

        {erroDeCarga ? (
          <p role="alert" className="aviso-de-erro">
            {erroDeCarga}
          </p>
        ) : null}

        {!carregando && guias?.length === 0 ? (
          <p className="folha px-4 py-6 text-center text-sm text-muted-foreground">
            Este paciente não tem nenhuma guia com saldo.
          </p>
        ) : null}

        {!carregando && guias && guias.length > 0 ? (
          <div className="folha divide-y divide-regua overflow-hidden">
            {/*
              Só existe aqui dentro: enquanto não há paciente escolhido e lista
              carregada, não há nada para marcar. Sem `name`, porque é controle
              de interação — o que o servidor lê continua sendo o checkbox de
              cada linha, e um `name` a mais desalinharia os vetores do
              `getAll`.
            */}
            <div className="flex items-center gap-3 bg-secondary/40 px-3 py-2.5">
              <input
                ref={refMarcarTodas}
                id="marcar-todas"
                type="checkbox"
                className="size-4 shrink-0"
                checked={todasMarcadas}
                aria-checked={parcialmenteMarcadas ? "mixed" : undefined}
                aria-label={
                  totalDeGuias === 1
                    ? "Marcar a única terapia com saldo deste paciente"
                    : `Marcar todas as ${totalDeGuias} terapias com saldo deste paciente`
                }
                onChange={(evento) => alternarTodas(evento.target.checked)}
              />
              <Label
                htmlFor="marcar-todas"
                className="text-xs font-medium text-muted-foreground"
              >
                Marcar todas
                <span className="font-normal">
                  ({marcadas.length} de {totalDeGuias})
                </span>
              </Label>
            </div>

            {guias.map((guia) => (
              <LinhaDeGuia
                key={guia.id}
                guia={guia}
                selecao={selecoes[guia.id]}
                // Índice do item no lote enviado: a posição entre as marcadas.
                // -1 quando a guia não está marcada, e aí nenhum erro aponta
                // para ela.
                indiceNoLote={marcadas.indexOf(guia)}
                itemComErro={erroExibido.item}
                aoAlternar={alternarGuia}
                aoAlterarCreditos={alterarCreditos}
              />
            ))}
          </div>
        ) : null}
      </section>

      {erroExibido.erro ? (
        <p role="alert" className="aviso-de-erro">
          {erroExibido.erro}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-regua-forte pt-5">
        <Button
          type="submit"
          size="lg"
          disabled={enviando || marcadas.length === 0}
        >
          {enviando ? "Lançando..." : "Lançar atendimentos"}
        </Button>
        <span className="text-sm text-muted-foreground">
          {marcadas.length === 0
            ? "Nenhuma terapia marcada."
            : `${marcadas.length} terapia(s) marcada(s).`}
        </span>
      </div>
    </form>
  );
}

/**
 * Uma guia com saldo: checkbox + créditos consumidos.
 *
 * O checkbox e o campo de créditos são enviados com o mesmo `name` em todas as
 * linhas (`requisicaoTerapiaId`, `creditosConsumidos`); o servidor lê os dois
 * vetores com `formData.getAll` e os costura por índice, na ordem do DOM.
 *
 * O alinhamento dos vetores é o que faz esse pareamento funcionar: um checkbox
 * não marcado não é enviado, e o campo de créditos ao lado fica `disabled`
 * (que também sai do envio) enquanto a terapia não está marcada. Assim os dois
 * vetores têm sempre o mesmo tamanho e a mesma ordem.
 *
 * O filete de margem repete o do painel: status da guia quando está tudo bem,
 * carmim quando o erro do servidor aponta para esta linha.
 */
function LinhaDeGuia({
  guia,
  selecao,
  indiceNoLote,
  itemComErro,
  aoAlternar,
  aoAlterarCreditos,
}: {
  guia: GuiaDisponivel;
  selecao: Selecao | undefined;
  indiceNoLote: number;
  itemComErro: number | undefined;
  aoAlternar: (guiaId: number, marcada: boolean) => void;
  aoAlterarCreditos: (guiaId: number, creditos: string) => void;
}) {
  const marcada = selecao?.marcada ?? false;
  const creditos = selecao?.creditos ?? CREDITOS_PADRAO;
  const temErro = indiceNoLote !== -1 && indiceNoLote === itemComErro;

  const idCheckbox = `guia-${guia.id}`;
  const idCreditos = `creditos-${guia.id}`;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-l-[3px] px-3 py-3 sm:flex-row sm:items-center",
        temErro
          ? "border-l-esgotada bg-esgotada-fundo/50"
          : MARCADOR_POR_STATUS[guia.statusAlerta],
        marcada && !temErro ? "bg-secondary/50" : null,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <input
          id={idCheckbox}
          type="checkbox"
          name="requisicaoTerapiaId"
          value={guia.id}
          checked={marcada}
          onChange={(evento) => aoAlternar(guia.id, evento.target.checked)}
          className="mt-1 size-4 shrink-0"
        />

        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor={idCheckbox} className="text-sm font-medium">
            {guia.terapiaNome}
            <span className="text-2xs font-normal text-muted-foreground">
              {guia.codigoTiss}
            </span>
          </Label>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <StatusBadge status={guia.statusAlerta} />
            <span>
              saldo{" "}
              <strong className="text-sm font-semibold text-foreground">
                {guia.saldoRestante}
              </strong>{" "}
              de {guia.qtdAutorizada}
            </span>
            <span>requisição {guia.numeroRequisicao}</span>
            <span>
              {guia.validade
                ? `validade ${formatarData(guia.validade)}`
                : "sem prazo de validade"}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 sm:w-28">
        <Label htmlFor={idCreditos} className="text-xs">
          Créditos
        </Label>
        <Input
          id={idCreditos}
          name="creditosConsumidos"
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          max={guia.saldoRestante}
          // Fora do envio quando a terapia não está marcada — é isso que
          // mantém os dois vetores do `getAll` alinhados.
          disabled={!marcada}
          className="h-9 text-right"
          value={creditos}
          aria-invalid={temErro ? true : undefined}
          onChange={(evento) => aoAlterarCreditos(guia.id, evento.target.value)}
        />
      </div>
    </div>
  );
}

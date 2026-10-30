"use client";

import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROTA_KLINI_PACIENTES } from "@/lib/auth/acesso";
import {
  criarRequisicaoAction,
  planoParaRequisicaoAction,
  previsaoDeSubstituicaoAction,
  type EstadoNovaRequisicao,
} from "@/lib/domain/requisicoes-actions";
import {
  APOIO_SUBSTITUIR,
  ERRO_PACIENTE_NAO_CADASTRADO,
  ERRO_PACIENTE_OBRIGATORIO,
  ERRO_QTD_INVALIDA,
  ERRO_SEM_ENCAMINHAMENTO,
  ERRO_SEM_TERAPIA,
  ERRO_TERAPIA_OBRIGATORIA,
  ERRO_TERAPIA_REPETIDA_NO_ENVIO,
  ROTULO_SUBSTITUIR,
  avisoDeRequisicoesApagadas,
  descreverItemDeSubstituicao,
  mensagemDeCriacao,
  mensagemDeSubstituicao,
  type ItemDeSubstituicao,
} from "@/lib/domain/requisicoes-mensagens";
import type { TerapiaParaEscolha } from "@/lib/domain/requisicoes";

import {
  ANUNCIO_PLANO_OFERECIDO,
  ANUNCIO_SEM_PLANO,
  AVISO_LINHAS_EDITADAS,
  AVISO_SEM_PLANO,
  ERRO_AO_CARREGAR_PLANO,
  ESPERA_DA_CONSULTA_MS,
  anuncioDePlanoCarregado,
  carregarPedeConfirmacao,
  chaveDoNome,
  decidirPreenchimento,
  linhaNova,
  linhasDoPlano,
  nomeEstaNaLista,
  temLinhaEditada,
  textoDoPlanoNaLinha,
  type CamposDaLinha,
  type LinhaDoFormulario,
  type TerapiaDoPlanoNoFormulario,
} from "./preenchimento-do-plano";

const ESTADO_INICIAL: EstadoNovaRequisicao = {};

/**
 * Recusas que são do campo de paciente, não do envio inteiro: aparecem junto
 * dele (com `aria-invalid`) em vez de soltas no fim do formulário.
 */
const ERROS_DO_PACIENTE = new Set([
  ERRO_PACIENTE_OBRIGATORIO,
  ERRO_PACIENTE_NAO_CADASTRADO,
  ERRO_SEM_ENCAMINHAMENTO,
]);

/**
 * Estado inicial da caixinha "Substituir guias da mesma terapia": **desmarcada**.
 *
 * Marcada, o envio apaga guias e atendimentos de outras requisições, e isso
 * não tem volta. Inverter o padrão é trocar este valor — o servidor não sabe
 * dele, só do que o formulário enviar.
 */
const SUBSTITUIR_PADRAO = false;

const ERRO_AO_VERIFICAR_SUBSTITUICAO =
  "Não foi possível verificar o que seria substituído. Tente de novo.";

/**
 * A última consulta do plano. `chave` é o nome consultado (`chaveDoNome`):
 * o que ela diz só vale enquanto o campo de paciente tiver esse mesmo nome.
 */
type ConsultaDoPlano =
  | { estado: "ociosa" }
  | { estado: "buscando"; chave: string }
  | { estado: "falhou"; chave: string }
  | {
      estado: "pronta";
      chave: string;
      encontrado: boolean;
      terapias: TerapiaDoPlanoNoFormulario[];
    };

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
  validadePadrao,
}: {
  nomesDePacientes: string[];
  terapias: TerapiaParaEscolha[];
  /**
   * "AAAA-MM-DD" a um mês do `CURRENT_DATE` do banco, com o dia grampeado no
   * último do mês quando ele não existe lá (31/01 -> 28/02). Toda linha de
   * terapia nasce com ela, inclusive as do botão "Adicionar outra terapia".
   */
  validadePadrao: string;
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
    linhaNova(0, validadePadrao),
  ]);
  const [erroLocal, setErroLocal] = useState<EstadoNovaRequisicao | null>(null);
  const [mensagemDeSucesso, setMensagemDeSucesso] = useState<string | null>(
    null,
  );
  const [substituir, setSubstituir] = useState(SUBSTITUIR_PADRAO);
  /**
   * O que a prévia disse que seria apagado. `null` enquanto o diálogo não deve
   * aparecer — como em `ExcluirPaciente`, o diálogo não existe sem a lista que
   * ele precisa citar.
   */
  const [previa, setPrevia] = useState<ItemDeSubstituicao[] | null>(null);
  const [verificando, iniciarVerificacao] = useTransition();
  const formularioRef = useRef<HTMLFormElement>(null);
  /**
   * Liga quando o envio já passou pela prévia (confirmado no diálogo, ou sem
   * nada a apagar): a próxima submissão vai direto para a action. É desligado
   * pela própria submissão que o consome.
   */
  const envioLiberado = useRef(false);

  // --- Plano do paciente (regra 26) ---------------------------------------
  const [consulta, setConsulta] = useState<ConsultaDoPlano>({
    estado: "ociosa",
  });
  /** Texto da região `aria-live`; o foco não se move quando o plano chega. */
  const [anuncio, setAnuncio] = useState("");
  const [confirmandoCarregamento, setConfirmandoCarregamento] = useState(false);
  const temporizadorDaConsulta = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  /** Nome já consultado (ou em consulta), para não repetir a mesma pergunta. */
  const chaveConsultada = useRef<string | null>(null);
  /** Só a resposta da consulta mais recente vale; as outras são descartadas. */
  const idDaConsulta = useRef(0);
  /**
   * As linhas como estão agora, para a resposta da consulta (que chega depois,
   * fora de qualquer evento) decidir sobre o estado atual e não o de quando
   * ela saiu.
   */
  const linhasAtuais = useRef(linhas);
  const botoesDeRemover = useRef(new Map<number, HTMLButtonElement>());
  const botaoAdicionarRef = useRef<HTMLButtonElement>(null);

  const chavesDaLista = useMemo(
    () => new Set(nomesDePacientes.map(chaveDoNome)),
    [nomesDePacientes],
  );

  useEffect(() => {
    linhasAtuais.current = linhas;
  }, [linhas]);

  useEffect(() => {
    const temporizador = temporizadorDaConsulta;

    return () => {
      if (temporizador.current) {
        clearTimeout(temporizador.current);
      }
    };
  }, []);

  // O que a consulta diz só vale para o nome que está no campo agora.
  const consultaDoNome =
    consulta.estado !== "ociosa" && consulta.chave === chaveDoNome(pacienteNome)
      ? consulta
      : null;
  const planoDoPaciente =
    consultaDoNome?.estado === "pronta" &&
    consultaDoNome.encontrado &&
    consultaDoNome.terapias.length > 0
      ? consultaDoNome.terapias
      : null;
  const pacienteSemPlano =
    consultaDoNome?.estado === "pronta" &&
    consultaDoNome.encontrado &&
    consultaDoNome.terapias.length === 0;
  const minutosDoPlano = new Map(
    (planoDoPaciente ?? []).map((terapia) => [
      String(terapia.terapiaId),
      terapia.minutosSemanais,
    ]),
  );
  const linhasEditadas = temLinhaEditada(linhas, validadePadrao);

  // O erro do cliente só vale até a próxima submissão; depois disso quem manda
  // é a resposta do servidor.
  const erroExibido = erroLocal ?? estado;
  const erroDoPaciente =
    erroExibido.erro && ERROS_DO_PACIENTE.has(erroExibido.erro)
      ? erroExibido.erro
      : null;

  // Limpeza pós-sucesso: sem navegar para o dashboard, o formulário volta ao
  // início ali mesmo para cadastrar a próxima requisição. O token evita limpar
  // duas vezes no StrictMode e transforma sucessos iguais em eventos distintos.
  useEffect(() => {
    const sucesso = estado.sucesso;

    if (!sucesso || tokenTratado.current === sucesso.token) {
      return;
    }

    tokenTratado.current = sucesso.token;

    // "Criada", "adicionada" e "atualizada" são eventos diferentes. Repetir o
    // número de uma requisição que o paciente já tem **não** é recusado: as
    // terapias entram na requisição que já existe, e a terapia que ela já
    // tinha atualiza a guia em vez de virar outra. Sem essas palavras, quem
    // digitou o número errado acharia ter criado uma requisição nova — e uma
    // quantidade sobrescrita passaria sem aviso.
    //
    // Com substituição, a frase diz o que foi apagado — com os números da
    // transação, não os da prévia.
    const mensagem =
      sucesso.substituidas.length > 0
        ? mensagemDeSubstituicao(sucesso.numeroRequisicao, sucesso.substituidas)
        : mensagemDeCriacao(
            sucesso.pacienteNome,
            sucesso.numeroRequisicao,
            sucesso.terapiasAdicionadas,
            sucesso.terapiasAtualizadas,
            sucesso.requisicaoCriada,
          );

    toast.success(mensagem, {
      description:
        sucesso.requisicoesApagadas.length > 0
          ? avisoDeRequisicoesApagadas(sucesso.requisicoesApagadas)
          : `Número ${sucesso.numeroRequisicao}.`,
    });

    setMensagemDeSucesso(mensagem);
    setPacienteNome("");
    setNumeroRequisicao("");
    // A caixinha volta ao padrão a cada requisição: apagar tem de ser uma
    // escolha deste envio, não uma sobra do anterior.
    setSubstituir(SUBSTITUIR_PADRAO);
    setLinhas([linhaNova(proximaChave.current++, validadePadrao)]);
    setErroLocal(null);
    // O próximo paciente começa sem plano consultado.
    idDaConsulta.current += 1;
    chaveConsultada.current = null;
    setConsulta({ estado: "ociosa" });
    setAnuncio("");

    requestAnimationFrame(() => campoPacienteRef.current?.focus());
    // `validadePadrao` entra nas dependências porque a linha limpa nasce com
    // ela: depois do `refresh()` da action, um cadastro feito na virada do dia
    // recebe a validade recalculada, não a que a página trouxe ao abrir. O
    // token barra a reexecução, então nada é limpo duas vezes.
  }, [estado, validadePadrao]);

  function adicionarLinha() {
    setMensagemDeSucesso(null);
    setLinhas((atuais) => [
      ...atuais,
      linhaNova(proximaChave.current++, validadePadrao),
    ]);
  }

  /**
   * Remove a linha e leva o foco ao "Remover" da linha que tomou o lugar dela
   * (ou da anterior, se era a última): Enter/Espaço repetidos tiram várias
   * linhas em sequência sem o foco cair no topo da página. Quando sobra uma
   * linha só (o "Remover" dela fica desabilitado), o foco vai para "Adicionar
   * outra terapia".
   */
  function removerLinha(chave: number) {
    setMensagemDeSucesso(null);

    const indice = linhas.findIndex((linha) => linha.chave === chave);
    const restantes = linhas.filter((linha) => linha.chave !== chave);
    const vizinha = restantes[indice] ?? restantes[indice - 1];

    setLinhas(restantes);

    requestAnimationFrame(() => {
      const proximo =
        vizinha && restantes.length > 1
          ? botoesDeRemover.current.get(vizinha.chave)
          : null;

      (proximo ?? botaoAdicionarRef.current)?.focus();
    });
  }

  /** Troca as linhas pelas do plano e anuncia, sem mexer no foco. */
  function aplicarPlano(terapiasDoPlano: TerapiaDoPlanoNoFormulario[]) {
    setMensagemDeSucesso(null);
    setLinhas(
      linhasDoPlano(
        terapiasDoPlano,
        validadePadrao,
        linhasAtuais.current.map((linha) => linha.chave),
        () => proximaChave.current++,
      ),
    );
    setAnuncio(anuncioDePlanoCarregado(terapiasDoPlano.length));
  }

  /**
   * Pergunta ao servidor o plano do nome digitado. Uma consulta por nome: o
   * mesmo nome não é consultado de novo enquanto continuar no campo.
   */
  function consultarPlano(nome: string) {
    if (temporizadorDaConsulta.current) {
      clearTimeout(temporizadorDaConsulta.current);
      temporizadorDaConsulta.current = null;
    }

    const chave = chaveDoNome(nome);

    if (!chave || chaveConsultada.current === chave) {
      return;
    }

    chaveConsultada.current = chave;
    idDaConsulta.current += 1;
    const id = idDaConsulta.current;
    setConsulta({ estado: "buscando", chave });

    planoParaRequisicaoAction(nome)
      .then((resultado) => {
        if (id !== idDaConsulta.current) {
          return;
        }

        if (!resultado.ok) {
          throw new Error("consulta do plano recusada");
        }

        if (!resultado.encontrado) {
          // Nome de ninguém, ou paciente sem encaminhamento: nada a preencher.
          // A recusa, se o usuário enviar, é a de sempre — vem da criação.
          setConsulta({ estado: "pronta", chave, encontrado: false, terapias: [] });
          return;
        }

        setConsulta({
          estado: "pronta",
          chave,
          encontrado: true,
          terapias: resultado.terapias,
        });

        const decisao = decidirPreenchimento(
          linhasAtuais.current,
          validadePadrao,
          resultado.terapias,
        );

        if (decisao === "preencher") {
          aplicarPlano(resultado.terapias);
        } else if (decisao === "oferecer") {
          setAnuncio(ANUNCIO_PLANO_OFERECIDO);
        } else {
          if (decisao === "limpar") {
            setLinhas([
              linhaNova(
                linhasAtuais.current[0]?.chave ?? proximaChave.current++,
                validadePadrao,
              ),
            ]);
          }
          setAnuncio(ANUNCIO_SEM_PLANO);
        }
      })
      .catch(() => {
        if (id !== idDaConsulta.current) {
          return;
        }

        // Sem preenchimento, mas o formulário continua utilizável. Sair do
        // campo de novo tenta outra vez.
        chaveConsultada.current = null;
        setConsulta({ estado: "falhou", chave });
        setAnuncio(ERRO_AO_CARREGAR_PLANO);
      });
  }

  /**
   * A cada tecla: descarta a consulta em curso de outro nome e, se o nome
   * digitado é um da lista, consulta depois de uma pausa na digitação. Nome
   * fora da lista só é consultado ao sair do campo.
   */
  function aoDigitarPaciente(nome: string) {
    if (temporizadorDaConsulta.current) {
      clearTimeout(temporizadorDaConsulta.current);
      temporizadorDaConsulta.current = null;
    }

    if (chaveDoNome(nome) !== chaveConsultada.current) {
      chaveConsultada.current = null;
      idDaConsulta.current += 1;
    }

    if (nomeEstaNaLista(nome, chavesDaLista)) {
      temporizadorDaConsulta.current = setTimeout(
        () => consultarPlano(nome),
        ESPERA_DA_CONSULTA_MS,
      );
    }
  }

  function carregarPlanoDoPaciente() {
    if (!planoDoPaciente) {
      return;
    }

    if (carregarPedeConfirmacao(linhas, validadePadrao)) {
      setConfirmandoCarregamento(true);
      return;
    }

    aplicarPlano(planoDoPaciente);
  }

  function confirmarCarregamento() {
    setConfirmandoCarregamento(false);

    if (planoDoPaciente) {
      aplicarPlano(planoDoPaciente);
    }
  }

  function alterarLinha(
    chave: number,
    campo: keyof CamposDaLinha,
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

    // Envio que já passou pela prévia: segue direto. A validação abaixo já
    // rodou na submissão que abriu a prévia, e os campos não mudaram desde
    // então (o diálogo é modal).
    if (envioLiberado.current) {
      envioLiberado.current = false;
      return;
    }

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

      if (
        linhas
          .slice(0, indice)
          .some((anterior) => anterior.terapiaId === linha.terapiaId)
      ) {
        evento.preventDefault();
        setErroLocal({ erro: ERRO_TERAPIA_REPETIDA_NO_ENVIO, linha: indice });
        return;
      }
    }

    setErroLocal(null);

    if (substituir) {
      evento.preventDefault();
      verificarSubstituicao();
    }
  }

  /**
   * Caixinha marcada: pergunta ao servidor o que seria apagado. Havendo algo,
   * abre o diálogo; não havendo, envia direto, sem diálogo.
   *
   * É só a prévia — o servidor refaz a consulta dentro da transação e apaga o
   * que casar naquele momento.
   */
  function verificarSubstituicao() {
    iniciarVerificacao(async () => {
      try {
        const resultado = await previsaoDeSubstituicaoAction({
          pacienteNome,
          numeroRequisicao,
          terapiaIds: linhas.map((linha) => Number(linha.terapiaId)),
        });

        if (!resultado.ok) {
          setErroLocal({ erro: resultado.erro });
          return;
        }

        if (resultado.itens.length === 0) {
          enviarSemNovaPrevia();
          return;
        }

        setPrevia(resultado.itens);
      } catch {
        setErroLocal({ erro: ERRO_AO_VERIFICAR_SUBSTITUICAO });
      }
    });
  }

  function enviarSemNovaPrevia() {
    envioLiberado.current = true;
    formularioRef.current?.requestSubmit();
  }

  function confirmarSubstituicao() {
    setPrevia(null);
    enviarSemNovaPrevia();
  }

  return (
    <>
      <form
        ref={formularioRef}
        action={action}
        onSubmit={validarNoCliente}
        noValidate
        className="flex flex-col gap-8"
      >
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="regua-de-secao">1. Paciente e requisição</h2>
            <p className="max-w-prose text-xs text-muted-foreground">
              Só pacientes com encaminhamento cadastrado. A comparação ignora
              maiúsculas e minúsculas: &quot;José Silva&quot; e &quot;JOSÉ
              SILVA&quot; são a mesma pessoa.{" "}
              <Link
                href="/klini/encaminhamentos"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Cadastrar encaminhamento
              </Link>
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
                aria-invalid={erroDoPaciente ? true : undefined}
                aria-describedby={
                  erroDoPaciente ? "pacienteNome-erro" : undefined
                }
                onChange={(evento) => {
                  setMensagemDeSucesso(null);
                  setPacienteNome(evento.target.value);
                  aoDigitarPaciente(evento.target.value);
                }}
                onBlur={(evento) => consultarPlano(evento.target.value)}
                placeholder="Digite ou escolha um paciente"
              />
              {erroDoPaciente ? (
                <p
                  id="pacienteNome-erro"
                  role="alert"
                  className="aviso-de-erro"
                >
                  {erroDoPaciente}
                </p>
              ) : null}
              {/*
              `datalist` sugere, não restringe: só traz quem já tem
              encaminhamento, mas digitar outro nome ainda envia — e o servidor
              recusa sem criar nada. Quem decide é a transação, não a lista.
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
                Repetir um número que este paciente já tem acrescenta as
                terapias àquela requisição, em vez de criar outra. Uma terapia
                que a requisição já tem não vira segunda guia: a quantidade e a
                validade dela são atualizadas, e os atendimentos já lançados
                continuam. O mesmo número em pacientes diferentes continua sendo
                requisições diferentes.
              </p>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="regua-de-secao">2. Terapias autorizadas</h2>
            <p className="max-w-prose text-xs text-muted-foreground">
              Uma linha por terapia. Ao escolher o paciente, as terapias do
              plano dele entram aqui: remova as que não foram autorizadas. A
              quantidade vem sugerida pelo plano (uma autorização por hora
              cheia na semana, no mínimo uma, vezes 4 semanas) e a validade,
              para um mês a partir de hoje. As duas são editáveis, e apagar a
              validade deixa a guia sem prazo.
            </p>
            {consultaDoNome?.estado === "buscando" ? (
              <p className="text-xs text-muted-foreground">
                Buscando o plano do paciente…
              </p>
            ) : null}
            {consultaDoNome?.estado === "falhou" ? (
              <p className="text-xs text-muted-foreground">
                {ERRO_AO_CARREGAR_PLANO}
              </p>
            ) : null}
            {pacienteSemPlano ? (
              <p className="text-xs text-muted-foreground">
                {AVISO_SEM_PLANO}{" "}
                <Link
                  href={ROTA_KLINI_PACIENTES}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  Cadastrar plano
                </Link>
              </p>
            ) : null}
            {planoDoPaciente && linhasEditadas ? (
              <p className="max-w-prose text-xs text-muted-foreground">
                {AVISO_LINHAS_EDITADAS}
              </p>
            ) : null}
            {/* Anúncio para leitor de tela; montado vazio, sempre presente. */}
            <p aria-live="polite" className="sr-only">
              {anuncio}
            </p>
          </div>

          <div className="folha divide-y divide-regua overflow-hidden">
            {linhas.map((linha, indice) => {
              const minutos = minutosDoPlano.get(linha.terapiaId);

              return (
                <LinhaDeTerapiaDoFormulario
                  key={linha.chave}
                  linha={linha}
                  indice={indice}
                  terapias={terapias}
                  podeRemover={linhas.length > 1}
                  temErro={erroExibido.linha === indice}
                  referenciaDoPlano={
                    minutos === undefined ? null : textoDoPlanoNaLinha(minutos)
                  }
                  refDoRemover={(botao) => {
                    if (botao) {
                      botoesDeRemover.current.set(linha.chave, botao);
                    } else {
                      botoesDeRemover.current.delete(linha.chave);
                    }
                  }}
                  aoAlterar={alterarLinha}
                  aoRemover={removerLinha}
                />
              );
            })}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              ref={botaoAdicionarRef}
              type="button"
              variant="outline"
              size="sm"
              className="h-10 sm:h-8"
              onClick={adicionarLinha}
            >
              Adicionar outra terapia
            </Button>
            {planoDoPaciente ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-10 sm:h-8"
                onClick={carregarPlanoDoPaciente}
              >
                Carregar plano do paciente
              </Button>
            ) : null}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="regua-de-secao">3. Guias antigas</h2>
          <div className="flex items-start gap-2.5">
            <input
              id="substituir"
              name="substituir"
              type="checkbox"
              value="sim"
              className="mt-0.5 size-4 shrink-0"
              checked={substituir}
              aria-describedby="substituir-apoio"
              onChange={(evento) => {
                setMensagemDeSucesso(null);
                setSubstituir(evento.target.checked);
              }}
            />
            <div className="flex min-w-0 flex-col gap-0.5">
              <Label htmlFor="substituir" className="text-sm font-medium">
                {ROTULO_SUBSTITUIR}
              </Label>
              <p
                id="substituir-apoio"
                className="max-w-prose text-xs text-muted-foreground"
              >
                {APOIO_SUBSTITUIR} Antes de gravar, o sistema mostra o que será
                apagado e pede confirmação.
              </p>
            </div>
          </div>
        </section>

        {erroExibido.erro && !erroDoPaciente ? (
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
          <BotaoDeSubmit verificando={verificando} />
          <Button asChild variant="ghost" size="sm">
            <Link href="/klini/dashboard">Cancelar</Link>
          </Button>
        </div>
      </form>

      <AlertDialog
        open={previa !== null}
        onOpenChange={(aberto) => {
          if (!aberto) {
            setPrevia(null);
          }
        }}
      >
        {previa === null ? null : (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Substituir e apagar guias antigas?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Estas guias de outras requisições de {pacienteNome.trim()} serão
                apagadas, com os atendimentos já lançados nelas. Isso não pode
                ser desfeito.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm break-words">
              {previa.map((item) => (
                <li key={`${item.numeroRequisicao}-${item.terapiaNome}`}>
                  {descreverItemDeSubstituicao(item)}
                </li>
              ))}
            </ul>

            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                className="bg-esgotada text-white hover:bg-esgotada/90"
                onClick={confirmarSubstituicao}
              >
                Substituir e apagar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>

      <AlertDialog
        open={confirmandoCarregamento && planoDoPaciente !== null}
        onOpenChange={(aberto) => {
          if (!aberto) {
            setConfirmandoCarregamento(false);
          }
        }}
      >
        {planoDoPaciente === null ? null : (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Trocar as linhas pelo plano do paciente?
              </AlertDialogTitle>
              <AlertDialogDescription>
                As linhas de terapia atuais, inclusive as que você editou ou
                acrescentou à mão, serão substituídas{" "}
                {planoDoPaciente.length === 1
                  ? "pela 1 terapia"
                  : `pelas ${planoDoPaciente.length} terapias`}{" "}
                do plano de {pacienteNome.trim()}. Nada é gravado até você
                criar a requisição.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={confirmarCarregamento}>
                Carregar plano
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </>
  );
}

function BotaoDeSubmit({ verificando }: { verificando: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="lg" disabled={pending || verificando}>
      {pending
        ? "Salvando..."
        : verificando
          ? "Verificando..."
          : "Criar requisição"}
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
 *
 * `referenciaDoPlano` ("Plano: 2 h por semana · sugestão 2 por semana, 8 no
 * mês") é só leitura: aparece
 * quando a terapia escolhida está no plano do paciente digitado, e não entra
 * no formulário enviado.
 */
function LinhaDeTerapiaDoFormulario({
  linha,
  indice,
  terapias,
  podeRemover,
  temErro,
  referenciaDoPlano,
  refDoRemover,
  aoAlterar,
  aoRemover,
}: {
  linha: LinhaDoFormulario;
  indice: number;
  terapias: TerapiaParaEscolha[];
  podeRemover: boolean;
  temErro: boolean;
  referenciaDoPlano: string | null;
  refDoRemover: (botao: HTMLButtonElement | null) => void;
  aoAlterar: (chave: number, campo: keyof CamposDaLinha, valor: string) => void;
  aoRemover: (chave: number) => void;
}) {
  const idTerapia = `terapia-${linha.chave}`;
  const idQuantidade = `quantidade-${linha.chave}`;
  const idValidade = `validade-${linha.chave}`;
  const idReferencia = `plano-${linha.chave}`;
  const nomeDaTerapia = terapias.find(
    (terapia) => String(terapia.id) === linha.terapiaId,
  )?.nome;

  return (
    <div
      className={`flex flex-col gap-2 border-l-[3px] px-3 py-3 ${
        temErro
          ? "border-l-esgotada bg-esgotada-fundo/50"
          : "border-l-transparent"
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
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
            aria-describedby={referenciaDoPlano ? idReferencia : undefined}
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
            aria-describedby={referenciaDoPlano ? idReferencia : undefined}
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
          ref={refDoRemover}
          type="button"
          variant="ghost"
          size="sm"
          // 40px de altura no celular: é o botão que se toca várias vezes
          // seguidas para tirar as terapias que não foram autorizadas.
          className="h-10 sm:mb-0.5 sm:h-8"
          aria-label={`Remover terapia ${indice + 1}${
            nomeDaTerapia ? ` (${nomeDaTerapia})` : ""
          }`}
          // A última linha não pode sair: a requisição precisa de pelo menos uma
          // terapia, e um formulário sem nenhuma linha não teria como voltar.
          disabled={!podeRemover}
          onClick={() => aoRemover(linha.chave)}
        >
          Remover
        </Button>
      </div>

      {referenciaDoPlano ? (
        <p
          id={idReferencia}
          className="text-xs break-words text-muted-foreground"
        >
          {referenciaDoPlano}
        </p>
      ) : null}
    </div>
  );
}

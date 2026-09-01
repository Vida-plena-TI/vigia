"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  editarAtendimento,
  excluirAtendimento,
} from "@/lib/domain/atendimentos-actions";
import {
  excluirGuia,
  listarHistoricoDaGuia,
} from "@/lib/domain/guias-actions";
import type {
  AtendimentoDoHistorico,
  GuiaDoDashboard,
} from "@/lib/domain/guias";

import { formatarData } from "./formato";
import { StatusBadge } from "./status-badge";

const CLASSE_TEXTAREA =
  "min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm";

/**
 * Botões de uma guia: "Histórico" sempre, "Excluir guia" só em Renovar e
 * Esgotada.
 *
 * Esconder o botão aqui é só para não oferecer uma ação que vai falhar. Quem
 * de fato rejeita a exclusão de uma guia "Regular" é a Server Action
 * `excluirGuia` (regra 9 do CONTEXT.md) — este componente pode ser
 * contornado, ela não.
 */
export function AcoesDaGuia({ guia }: { guia: GuiaDoDashboard }) {
  const podeExcluir = guia.statusAlerta !== "Regular";

  return (
    <div className="flex flex-wrap gap-2 md:justify-end">
      <HistoricoDaGuia guia={guia} />
      {podeExcluir ? <ExcluirGuia guia={guia} /> : null}
    </div>
  );
}

/** Diálogo com os atendimentos da guia, carregados sob demanda. */
function HistoricoDaGuia({ guia }: { guia: GuiaDoDashboard }) {
  const [aberto, setAberto] = useState(false);
  const [atendimentos, setAtendimentos] = useState<
    AtendimentoDoHistorico[] | null
  >(null);
  const [erro, setErro] = useState<string | null>(null);
  const [erroDaLinha, setErroDaLinha] = useState<{
    id: number;
    mensagem: string;
  } | null>(null);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [operacao, setOperacao] = useState<{
    tipo: "editar" | "excluir";
    id: number;
  } | null>(null);
  const [pendente, iniciarTransicao] = useTransition();

  const totalUtilizado = useMemo(() => {
    if (!atendimentos) {
      return guia.qtdUtilizada;
    }

    return atendimentos.reduce(
      (total, atendimento) => total + atendimento.creditosConsumidos,
      0,
    );
  }, [atendimentos, guia.qtdUtilizada]);

  async function carregarHistorico(): Promise<boolean> {
    try {
      setErro(null);
      setAtendimentos(await listarHistoricoDaGuia(guia.id));
      return true;
    } catch {
      setErro("Não foi possível carregar o histórico.");
      return false;
    }
  }

  function aoAbrirOuFechar(proximo: boolean) {
    setAberto(proximo);

    if (!proximo) {
      setEditandoId(null);
      setErroDaLinha(null);
      return;
    }

    if (atendimentos !== null) {
      return;
    }

    iniciarTransicao(async () => {
      await carregarHistorico();
    });
  }

  function salvarAtendimento(
    atendimento: AtendimentoDoHistorico,
    dados: {
      dataAtendimento: string;
      creditosConsumidos: string;
      observacao: string;
    },
  ) {
    setErroDaLinha(null);
    setOperacao({ tipo: "editar", id: atendimento.id });

    iniciarTransicao(async () => {
      try {
        const resultado = await editarAtendimento({
          atendimentoId: atendimento.id,
          dataAtendimento: dados.dataAtendimento,
          creditosConsumidos: dados.creditosConsumidos,
          observacao: dados.observacao,
        });

        if (!resultado.ok) {
          setErroDaLinha({ id: atendimento.id, mensagem: resultado.erro });
          return;
        }

        if (await carregarHistorico()) {
          setEditandoId(null);
        }
      } catch {
        setErroDaLinha({
          id: atendimento.id,
          mensagem: "Não foi possível editar o atendimento.",
        });
      } finally {
        setOperacao(null);
      }
    });
  }

  function confirmarExclusao(atendimento: AtendimentoDoHistorico) {
    setErroDaLinha(null);
    setOperacao({ tipo: "excluir", id: atendimento.id });

    iniciarTransicao(async () => {
      try {
        const resultado = await excluirAtendimento(atendimento.id);

        if (!resultado.ok) {
          setErroDaLinha({ id: atendimento.id, mensagem: resultado.erro });
          return;
        }

        await carregarHistorico();
      } catch {
        setErroDaLinha({
          id: atendimento.id,
          mensagem: "Não foi possível excluir o atendimento.",
        });
      } finally {
        setOperacao(null);
      }
    });
  }

  const carregandoInicial = pendente && atendimentos === null;

  return (
    <Dialog open={aberto} onOpenChange={aoAbrirOuFechar}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Histórico
        </Button>
      </DialogTrigger>

      <DialogContent className="rounded-2xl sm:max-w-4xl">
        <DialogHeader className="border-b border-regua pb-3">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-lg font-semibold">
            {guia.terapiaNome}
            <StatusBadge status={guia.statusAlerta} />
          </DialogTitle>
          <DialogDescription className="text-sm">
            {guia.pacienteNome} · requisição {guia.numeroRequisicao} ·{" "}
            <strong className="font-semibold text-foreground">
              {totalUtilizado} de {guia.qtdAutorizada}
            </strong>{" "}
            crédito(s) utilizado(s).
          </DialogDescription>
        </DialogHeader>

        {pendente ? (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {carregandoInicial ? "Carregando..." : "Atualizando..."}
          </p>
        ) : null}

        {erro ? (
          <p role="alert" className="text-sm text-destructive">
            {erro}
          </p>
        ) : null}

        {!carregandoInicial && !erro && atendimentos?.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum atendimento lançado nesta guia.
          </p>
        ) : null}

        {!carregandoInicial && atendimentos && atendimentos.length > 0 ? (
          <div className="max-h-[28rem] overflow-y-auto rounded-md border border-regua">
            <Table>
              <TableHeader>
                <TableRow className="border-regua-forte hover:bg-transparent">
                  <TableHead className="text-2xs font-medium text-muted-foreground">
                    Data
                  </TableHead>
                  <TableHead className="w-28 text-right text-2xs font-medium text-muted-foreground">
                    Créditos
                  </TableHead>
                  <TableHead className="text-2xs font-medium text-muted-foreground">
                    Observação
                  </TableHead>
                  <TableHead className="w-56 text-right text-2xs font-medium text-muted-foreground">
                    Ações
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {atendimentos.map((atendimento) => (
                  <LinhaDoHistorico
                    key={atendimento.id}
                    atendimento={atendimento}
                    editando={editandoId === atendimento.id}
                    desabilitado={pendente}
                    salvando={
                      operacao?.tipo === "editar" &&
                      operacao.id === atendimento.id
                    }
                    excluindo={
                      operacao?.tipo === "excluir" &&
                      operacao.id === atendimento.id
                    }
                    erro={
                      erroDaLinha?.id === atendimento.id
                        ? erroDaLinha.mensagem
                        : null
                    }
                    aoEditar={() => {
                      setErroDaLinha(null);
                      setEditandoId(atendimento.id);
                    }}
                    aoCancelar={() => {
                      setErroDaLinha(null);
                      setEditandoId(null);
                    }}
                    aoSalvar={(dados) => salvarAtendimento(atendimento, dados)}
                    aoExcluir={() => confirmarExclusao(atendimento)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function LinhaDoHistorico({
  atendimento,
  editando,
  desabilitado,
  salvando,
  excluindo,
  erro,
  aoEditar,
  aoCancelar,
  aoSalvar,
  aoExcluir,
}: {
  atendimento: AtendimentoDoHistorico;
  editando: boolean;
  desabilitado: boolean;
  salvando: boolean;
  excluindo: boolean;
  erro: string | null;
  aoEditar: () => void;
  aoCancelar: () => void;
  aoSalvar: (dados: {
    dataAtendimento: string;
    creditosConsumidos: string;
    observacao: string;
  }) => void;
  aoExcluir: () => void;
}) {
  const [dataAtendimento, setDataAtendimento] = useState(
    atendimento.dataAtendimento,
  );
  const [creditosConsumidos, setCreditosConsumidos] = useState(
    String(atendimento.creditosConsumidos),
  );
  const [observacao, setObservacao] = useState(atendimento.observacao ?? "");

  useEffect(() => {
    if (!editando) {
      return;
    }

    setDataAtendimento(atendimento.dataAtendimento);
    setCreditosConsumidos(String(atendimento.creditosConsumidos));
    setObservacao(atendimento.observacao ?? "");
  }, [atendimento, editando]);

  if (editando) {
    return (
      <TableRow>
        <TableCell className="align-top">
          <Input
            aria-label="Data do atendimento"
            type="date"
            value={dataAtendimento}
            disabled={desabilitado}
            onChange={(evento) => setDataAtendimento(evento.target.value)}
          />
        </TableCell>
        <TableCell className="align-top">
          <Input
            aria-label="Créditos consumidos"
            type="number"
            min={0}
            step={1}
            value={creditosConsumidos}
            disabled={desabilitado}
            className="text-right tabular-nums"
            onChange={(evento) => setCreditosConsumidos(evento.target.value)}
          />
        </TableCell>
        <TableCell className="min-w-56 align-top">
          <textarea
            aria-label="Observação"
            value={observacao}
            disabled={desabilitado}
            className={CLASSE_TEXTAREA}
            onChange={(evento) => setObservacao(evento.target.value)}
          />
        </TableCell>
        <TableCell className="align-top">
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              disabled={desabilitado}
              onClick={() =>
                aoSalvar({
                  dataAtendimento,
                  creditosConsumidos,
                  observacao,
                })
              }
            >
              {salvando ? "Salvando..." : "Salvar"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={desabilitado}
              onClick={aoCancelar}
            >
              Cancelar
            </Button>
          </div>
          {erro ? (
            <p role="alert" className="mt-2 text-left text-xs text-destructive">
              {erro}
            </p>
          ) : null}
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell className="whitespace-nowrap">
        {formatarData(atendimento.dataAtendimento)}
      </TableCell>
      <TableCell className="text-right font-semibold">
        {atendimento.creditosConsumidos}
      </TableCell>
      <TableCell className="whitespace-normal text-muted-foreground">
        {atendimento.observacao ?? (
          <span className="text-xs italic">sem observação</span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={desabilitado}
            onClick={aoEditar}
          >
            Editar
          </Button>
          <ExcluirAtendimentoDoHistorico
            atendimento={atendimento}
            desabilitado={desabilitado}
            excluindo={excluindo}
            aoConfirmar={aoExcluir}
          />
        </div>
        {erro ? (
          <p role="alert" className="mt-2 text-left text-xs text-destructive">
            {erro}
          </p>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

function ExcluirAtendimentoDoHistorico({
  atendimento,
  desabilitado,
  excluindo,
  aoConfirmar,
}: {
  atendimento: AtendimentoDoHistorico;
  desabilitado: boolean;
  excluindo: boolean;
  aoConfirmar: () => void;
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <AlertDialog open={aberto} onOpenChange={setAberto}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={desabilitado}>
          Excluir
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir este atendimento?</AlertDialogTitle>
          <AlertDialogDescription>
            Atendimento de {formatarData(atendimento.dataAtendimento)} com{" "}
            {atendimento.creditosConsumidos} crédito(s). Não dá para desfazer.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={excluindo}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            className="bg-esgotada text-white hover:bg-esgotada/90"
            disabled={excluindo}
            onClick={(evento) => {
              evento.preventDefault();
              setAberto(false);
              aoConfirmar();
            }}
          >
            {excluindo ? "Excluindo..." : "Excluir"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Confirmação de exclusão. Avisa que os atendimentos vão junto (cascade). */
function ExcluirGuia({ guia }: { guia: GuiaDoDashboard }) {
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [excluindo, iniciarExclusao] = useTransition();

  function confirmar() {
    setErro(null);

    iniciarExclusao(async () => {
      try {
        const resultado = await excluirGuia(guia.id);

        if (resultado.ok) {
          setAberto(false);
          return;
        }

        // Ex.: a guia virou "Regular" (ou sumiu) desde que a página foi
        // renderizada. O diálogo fica aberto mostrando o motivo.
        setErro(resultado.erro);
      } catch {
        setErro("Não foi possível excluir a guia.");
      }
    });
  }

  return (
    <AlertDialog
      open={aberto}
      onOpenChange={(proximo) => {
        setAberto(proximo);
        if (!proximo) {
          setErro(null);
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          Excluir guia
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir esta guia?</AlertDialogTitle>
          <AlertDialogDescription>
            {guia.terapiaNome} de {guia.pacienteNome} (requisição{" "}
            {guia.numeroRequisicao}). Os atendimentos lançados nela também serão
            apagados. Não dá para desfazer.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {erro ? (
          <p
            role="alert"
            className="aviso-de-erro"
          >
            {erro}
          </p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={excluindo}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            className="bg-esgotada text-white hover:bg-esgotada/90"
            disabled={excluindo}
            // Sem o preventDefault o Radix fecha o diálogo no clique e o erro
            // devolvido pela action não chegaria a aparecer.
            onClick={(evento) => {
              evento.preventDefault();
              confirmar();
            }}
          >
            {excluindo ? "Excluindo..." : "Excluir guia"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

"use client";

import { useId, useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { piorStatus } from "@/lib/domain/guias-apresentacao";
import type { GuiaDoDashboard, PacienteComGuias } from "@/lib/domain/guias";

import { AcoesDaGuia } from "./acoes-da-guia";
import { BotaoDeCopiar } from "./botao-de-copiar";
import {
  MARCADOR_POR_STATUS,
  formatarData,
  normalizarParaBusca,
} from "./formato";
import { StatusBadge } from "./status-badge";

/**
 * Lista de guias agrupada por paciente, com filtro por nome.
 *
 * O filtro é client-side: a lista inteira já veio renderizada do servidor, e
 * filtrar em memória evita um ida-e-volta por tecla digitada. Para o volume de
 * uma clínica isso é de longe o mais simples que funciona — se a lista crescer
 * a ponto de pesar, aí sim o filtro vira `searchParams` + consulta no banco.
 *
 * Visualmente é um livro-razão: uma folha só, com os pacientes separados por
 * faixa, e não um cartão flutuante por paciente. A tela é para varrer de cima
 * a baixo; cartões independentes sugeririam que cada paciente é um objeto que
 * se lê isolado.
 *
 * Cada paciente começa **recolhido**. O que se perde ao fechar a tabela é
 * devolvido pelo cabeçalho: o selo do pior status entre as guias do paciente e
 * o filete de margem na mesma cor. Nenhum "Esgotada" fica escondido dentro de
 * um paciente fechado — dá para varrer a coluna da esquerda com tudo fechado e
 * saber onde abrir.
 */
export function ListaDeGuias({
  pacientes,
}: {
  pacientes: PacienteComGuias[];
}) {
  const [busca, setBusca] = useState("");

  /**
   * Só os pacientes que o usuário abriu ou fechou **na mão**.
   *
   * O estado exibido é derivado: sem entrada aqui, vale o padrão — recolhido
   * quando não há busca, expandido quando há. É isso que faz o filtro abrir
   * sozinho o que sobrou no resultado sem precisar de efeito nenhum: o padrão
   * muda junto com o termo, e quem digita já vê as guias.
   *
   * Um paciente fechado à mão durante uma busca continua fechado, e um aberto
   * à mão continua aberto depois que a busca é limpa. A escolha explícita do
   * usuário sempre ganha do padrão.
   */
  const [manuais, setManuais] = useState<Record<number, boolean>>({});

  const termo = normalizarParaBusca(busca);
  const filtrando = termo !== "";

  const visiveis = useMemo(() => {
    if (!termo) {
      return pacientes;
    }

    return pacientes.filter((paciente) =>
      normalizarParaBusca(paciente.nome).includes(termo),
    );
  }, [pacientes, termo]);

  function estaAberto(pacienteId: number): boolean {
    return manuais[pacienteId] ?? filtrando;
  }

  function alternar(pacienteId: number) {
    setManuais((atuais) => ({
      ...atuais,
      [pacienteId]: !(atuais[pacienteId] ?? filtrando),
    }));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex w-full flex-col gap-1.5 sm:w-72">
          <Label htmlFor="busca-paciente" className="text-xs">
            Buscar paciente
          </Label>
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="busca-paciente"
              type="search"
              placeholder="Nome do paciente"
              autoComplete="off"
              value={busca}
              onChange={(evento) => setBusca(evento.target.value)}
              className="h-9 pl-8"
            />
          </div>
        </div>

        <p className="pb-2 text-xs text-muted-foreground" aria-live="polite">
          {termo
            ? `${visiveis.length} de ${pacientes.length} paciente(s)`
            : `${pacientes.length} paciente(s)`}
        </p>
      </div>

      {pacientes.length === 0 ? (
        <p className="folha px-4 py-8 text-center text-sm text-muted-foreground">
          Nenhuma guia cadastrada ainda.
        </p>
      ) : null}

      {pacientes.length > 0 && visiveis.length === 0 ? (
        <p className="folha px-4 py-8 text-center text-sm text-muted-foreground">
          Nenhum paciente encontrado para &ldquo;{busca.trim()}&rdquo;.
        </p>
      ) : null}

      {visiveis.length > 0 ? (
        <div className="folha divide-y divide-regua-forte overflow-hidden">
          {visiveis.map((paciente) => (
            <PacienteRecolhivel
              key={paciente.id}
              paciente={paciente}
              aberto={estaAberto(paciente.id)}
              aoAlternar={() => alternar(paciente.id)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Um paciente do livro-razão: cabeçalho sempre visível, guias sob demanda.
 *
 * O cabeçalho é uma linha com **dois controles irmãos** — o botão que abre e
 * fecha, e o de copiar. Aninhar um dentro do outro seria HTML inválido, e
 * mesmo com `stopPropagation` o clique em copiar acabaria abrindo o paciente
 * sem querer.
 *
 * O botão de abrir segue o padrão de acordeão do WAI-ARIA: fica dentro do
 * `<h2>` (para o leitor de tela continuar navegando por cabeçalho), carrega
 * `aria-expanded` e aponta com `aria-controls` para o painel, que existe no
 * DOM aberto ou fechado. O conteúdo do painel só é montado quando aberto: são
 * dezenas de diálogos de histórico e exclusão que não precisam existir
 * enquanto ninguém olha.
 */
function PacienteRecolhivel({
  paciente,
  aberto,
  aoAlternar,
}: {
  paciente: PacienteComGuias;
  aberto: boolean;
  aoAlternar: () => void;
}) {
  const idPainel = useId();
  const pior = piorStatus(paciente.guias);

  return (
    <section>
      <div
        className={cn(
          "flex items-center gap-1 border-l-[3px] bg-secondary/60",
          // Mesmo filete de margem das linhas da tabela, agora resumindo o
          // paciente inteiro: com tudo recolhido, a coluna da esquerda continua
          // dizendo onde olhar.
          pior ? MARCADOR_POR_STATUS[pior] : "border-l-transparent",
        )}
      >
        <h2 className="min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={aberto}
            aria-controls={idPainel}
            onClick={aoAlternar}
            // O anel de foco padrão fica do lado de fora (`outline-offset: 2px`)
            // e seria cortado pelo `overflow-hidden` da folha; aqui ele entra
            // para dentro da linha em vez de sumir.
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left focus-visible:[outline-offset:-3px]"
          >
            <ChevronRight
              aria-hidden
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                aberto && "rotate-90",
              )}
            />

            <span className="truncate text-base font-semibold">
              {paciente.nome}
            </span>

            {pior ? (
              <>
                <span className="sr-only">Pior status: </span>
                <StatusBadge status={pior} />
              </>
            ) : null}

            {/*
              No celular a contagem sai de cena: com selo, contagem e botão de
              copiar na mesma linha de 390px, quem era cortado era o nome do
              paciente — que é o que se lê primeiro. A contagem reaparece
              assim que há largura, e de todo jeito ela está logo abaixo quando
              o paciente abre.
            */}
            <span className="ml-auto hidden pl-2 text-xs whitespace-nowrap text-muted-foreground sm:inline">
              {paciente.guias.length} guia(s)
            </span>
          </button>
        </h2>

        <div className="shrink-0 pr-2 pl-1">
          <BotaoDeCopiar paciente={paciente} />
        </div>
      </div>

      <div id={idPainel} hidden={!aberto}>
        {aberto ? (
          <>
            {/* Densa no desktop, empilhada no celular: ver `GuiaEmBloco`. */}
            <div className="hidden md:block">
              <TabelaDeGuias guias={paciente.guias} />
            </div>

            <ul className="divide-y divide-regua md:hidden">
              {paciente.guias.map((guia) => (
                <li key={guia.id}>
                  <GuiaEmBloco guia={guia} />
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </section>
  );
}

/** Cabeçalho de coluna: peso 500 e cinza. Sem caixa alta, sem espacejamento. */
const CLASSE_CABECALHO =
  "px-3 py-1.5 text-left text-2xs font-medium text-muted-foreground";

function TabelaDeGuias({ guias }: { guias: GuiaDoDashboard[] }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-regua-forte">
          <th
            scope="col"
            className={cn(CLASSE_CABECALHO, "border-l-[3px] border-l-transparent")}
          >
            Terapia
          </th>
          <th scope="col" className={CLASSE_CABECALHO}>
            Requisição
          </th>
          <th scope="col" className={cn(CLASSE_CABECALHO, "text-right")}>
            Autorizada
          </th>
          <th scope="col" className={cn(CLASSE_CABECALHO, "text-right")}>
            Utilizada
          </th>
          <th scope="col" className={cn(CLASSE_CABECALHO, "text-right")}>
            Saldo
          </th>
          <th scope="col" className={CLASSE_CABECALHO}>
            Validade
          </th>
          <th scope="col" className={CLASSE_CABECALHO}>
            Status
          </th>
          <th scope="col" className={cn(CLASSE_CABECALHO, "text-right")}>
            Ações
          </th>
        </tr>
      </thead>

      <tbody>
        {guias.map((guia) => (
          <tr
            key={guia.id}
            className={cn(
              "border-b border-l-[3px] border-regua last:border-b-0 hover:bg-secondary/40",
              MARCADOR_POR_STATUS[guia.statusAlerta],
            )}
          >
            <td className="px-3 py-2 font-medium">
              {guia.terapiaNome}
              <span className="ml-1.5 text-2xs font-normal text-muted-foreground">
                {guia.codigoTiss}
              </span>
            </td>
            <td className="px-3 py-2 text-muted-foreground">
              {guia.numeroRequisicao}
            </td>
            <td className="px-3 py-2 text-right text-muted-foreground">
              {guia.qtdAutorizada}
            </td>
            <td className="px-3 py-2 text-right text-muted-foreground">
              {guia.qtdUtilizada}
            </td>
            {/*
              Autorizada e utilizada são contexto; saldo é o número da decisão.
              Por isso só ele fica na tinta cheia — e vira carmim quando zera,
              porque aí o próprio número já é o alerta.
            */}
            <td
              className={cn(
                "px-3 py-2 text-right",
                guia.saldoRestante <= 0
                  ? "font-bold text-esgotada"
                  : "font-semibold",
              )}
            >
              {guia.saldoRestante}
            </td>
            <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
              {formatarData(guia.validade)}
            </td>
            <td className="px-3 py-2">
              <StatusBadge status={guia.statusAlerta} />
            </td>
            <td className="px-3 py-2">
              <AcoesDaGuia guia={guia} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * A mesma guia no celular.
 *
 * Oito colunas com rolagem horizontal seriam ilegíveis num aparelho de mão —
 * e é justamente na recepção que se olha o telefone. O bloco mantém a mesma
 * hierarquia da tabela: terapia e status no topo, saldo em destaque, o resto
 * como contexto.
 */
function GuiaEmBloco({ guia }: { guia: GuiaDoDashboard }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 border-l-[3px] px-4 py-3",
        MARCADOR_POR_STATUS[guia.statusAlerta],
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{guia.terapiaNome}</p>
          <p className="text-2xs text-muted-foreground">
            {guia.codigoTiss} · requisição {guia.numeroRequisicao}
          </p>
        </div>
        <StatusBadge status={guia.statusAlerta} />
      </div>

      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
        <div className="flex items-baseline gap-1.5">
          <dt className="text-muted-foreground">Saldo</dt>
          <dd
            className={cn(
              "text-base",
              guia.saldoRestante <= 0
                ? "font-bold text-esgotada"
                : "font-semibold",
            )}
          >
            {guia.saldoRestante}
          </dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dt className="text-muted-foreground">Utilizada</dt>
          <dd>
            {guia.qtdUtilizada} de {guia.qtdAutorizada}
          </dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dt className="text-muted-foreground">Validade</dt>
          <dd>{formatarData(guia.validade)}</dd>
        </div>
      </dl>

      <AcoesDaGuia guia={guia} />
    </div>
  );
}

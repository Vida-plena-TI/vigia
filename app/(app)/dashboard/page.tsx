import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  agruparPorPaciente,
  contarPorStatus,
  listarGuiasDoDashboard,
} from "@/lib/domain/guias";

import { AvisoDeCriacao } from "./aviso-de-criacao";
import { ListaDeGuias } from "./lista-de-guias";
import { ResumoDeStatus } from "./resumo-de-status";

export const metadata: Metadata = {
  title: "Painel de guias | VIGIA",
};

/**
 * Dashboard: todas as guias do sistema, agrupadas por paciente.
 *
 * Server Component: a leitura acontece no servidor e o banco nunca é exposto
 * ao cliente. O que vai para o navegador é só o resultado já pronto — o filtro
 * de busca (`ListaDeGuias`) e os diálogos (`AcoesDaGuia`) são as únicas partes
 * client-side.
 *
 * A autenticação é garantida pelo layout `app/(app)/layout.tsx`
 * (`requireUsuario`), além da triagem do `proxy.ts`.
 *
 * Esta é uma tela densa: ocupa a largura toda disponível, alinhada à mesma
 * borda esquerda do cabeçalho. As telas de formulário fazem o contrário
 * (medida estreita) — a diferença de largura é o que diz, antes de qualquer
 * leitura, se a tela é para varrer ou para preencher.
 */
/** Lê um parâmetro de busca só quando ele veio uma única vez, como texto. */
function textoDaQuery(valor: string | string[] | undefined): string | null {
  return typeof valor === "string" && valor !== "" ? valor : null;
}

export default async function DashboardPage({
  searchParams,
}: PageProps<"/dashboard">) {
  // Independentes: a query já está resolvida, a consulta é que custa.
  const [guias, parametros] = await Promise.all([
    listarGuiasDoDashboard(),
    searchParams,
  ]);

  // Posto na URL pelo `redirect` de `criarRequisicaoAction`.
  const requisicaoCriada = textoDaQuery(parametros.criada);

  return (
    <div className="flex flex-col gap-5">
      {requisicaoCriada ? (
        <AvisoDeCriacao
          numeroRequisicao={requisicaoCriada}
          pacienteNome={textoDaQuery(parametros.paciente)}
        />
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-regua-forte pb-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Painel de guias</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Saldo e alerta de cada autorização de terapia, recalculados a cada
            atendimento lançado.
          </p>
        </div>

        <Button asChild size="lg">
          <Link href="/requisicoes/nova">Nova requisição</Link>
        </Button>
      </div>

      <ResumoDeStatus resumo={contarPorStatus(guias)} />

      <ListaDeGuias pacientes={agruparPorPaciente(guias)} />
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { ROTA_SULAMERICA } from "@/lib/auth/acesso";
import { requireAcessoARota } from "@/lib/auth/current-user";
import { PATHNAME_HEADER } from "@/lib/auth/pathname-header";
import { dataDeHoje } from "@/lib/domain/atendimentos";
import { listarNomesDePacientes } from "@/lib/domain/pacientes";
import { contarPorStatusDeAutorizacao, listarAutorizacoes } from "@/lib/domain/autorizacoes-sulamerica";
import { ResumoDeVencimentos } from "../../klini/encaminhamentos/resumo-de-vencimentos";
import { FormularioDeAutorizacao } from "./formulario-de-autorizacao";
import { ListaDeAutorizacoes } from "./lista-de-autorizacoes";

export const metadata: Metadata = { title: "SulAmérica | VIGIA" };

export default async function SulamericaPage() {
  await requireAcessoARota(ROTA_SULAMERICA, (await headers()).get(PATHNAME_HEADER));
  const [autorizacoes, nomesDePacientes, hoje] = await Promise.all([
    listarAutorizacoes(), listarNomesDePacientes(), dataDeHoje(),
  ]);
  return (
    <div className="flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2 border-b border-regua-forte pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">SulAmérica</h1>
          <Link href="/" className="text-sm font-medium underline underline-offset-4 hover:text-muted-foreground">
            Trocar convênio
          </Link>
        </div>
        <p className="max-w-prose text-sm text-muted-foreground">
          Autorizações com validade de 3, 6 ou 12 meses a partir da data de início.
          Cada paciente tem uma autorização — cadastrar outra substitui a anterior.
        </p>
      </div>
      <section className="flex flex-col gap-4">
        <h2 className="regua-de-secao">Nova autorização</h2>
        <FormularioDeAutorizacao nomesDePacientes={nomesDePacientes} hoje={hoje} />
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="regua-de-secao">Registradas
          <span className="text-sm font-normal text-muted-foreground">{autorizacoes.length}</span>
        </h2>
        <ResumoDeVencimentos resumo={contarPorStatusDeAutorizacao(autorizacoes)}
          rotulo="Resumo de autorizações SulAmérica por vencimento" />
        <ListaDeAutorizacoes autorizacoes={autorizacoes} />
      </section>
    </div>
  );
}

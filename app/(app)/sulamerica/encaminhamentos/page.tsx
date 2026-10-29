import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { ROTA_SULAMERICA_ENCAMINHAMENTOS, ROTA_SULAMERICA_PACIENTES } from "@/lib/auth/acesso";
import { requireAcessoARota } from "@/lib/auth/current-user";
import { PATHNAME_HEADER } from "@/lib/auth/pathname-header";
import { dataDeHoje } from "@/lib/domain/atendimentos";
import { listarEncaminhamentosSulamerica } from "@/lib/domain/autorizacoes-sulamerica";
import { listarPacientesParaEncaminhamento } from "@/lib/domain/pacientes";
import { FormularioDeEncaminhamentoSulamerica } from "./formulario-de-encaminhamento-sulamerica";
import { ListaDeEncaminhamentosSulamerica } from "./lista-de-encaminhamentos-sulamerica";

export const metadata: Metadata = { title: "Encaminhamentos SulAmérica | VIGIA" };

/**
 * Cadastro de encaminhamento da SulAmérica — só de paciente já cadastrado na
 * aba Cadastro da SulAmérica (regra 24; não cria paciente). Só admin:
 * `requireAcessoARota` relê o papel no banco antes de qualquer leitura, porque
 * a lista traz carteirinha e CRM.
 */
export default async function EncaminhamentosSulamericaPage() {
  await requireAcessoARota(ROTA_SULAMERICA_ENCAMINHAMENTOS, (await headers()).get(PATHNAME_HEADER));
  const [encaminhamentos, pacientes, hoje] = await Promise.all([
    listarEncaminhamentosSulamerica(), listarPacientesParaEncaminhamento("sulamerica"), dataDeHoje(),
  ]);
  return (
    <div className="flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2 border-b border-regua-forte pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Encaminhamentos SulAmérica</h1>
          <Link href="/" className="text-sm font-medium underline underline-offset-4 hover:text-muted-foreground">
            Trocar convênio
          </Link>
        </div>
        <p className="max-w-prose text-sm text-muted-foreground">
          A autorização começa na data do encaminhamento e vale 3, 6 ou 12 meses.
          Cada paciente tem uma autorização — cadastrar outra substitui a anterior.
          Só paciente já cadastrado na aba{" "}
          <Link href={ROTA_SULAMERICA_PACIENTES} className="font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground">
            Cadastro
          </Link>{" "}
          recebe encaminhamento.
        </p>
      </div>
      <section className="flex flex-col gap-4">
        <h2 className="regua-de-secao">Novo encaminhamento</h2>
        <FormularioDeEncaminhamentoSulamerica pacientes={pacientes} hoje={hoje} rotaDoCadastro={ROTA_SULAMERICA_PACIENTES} />
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="regua-de-secao">Registrados
          <span className="text-sm font-normal text-muted-foreground">{encaminhamentos.length}</span>
        </h2>
        <ListaDeEncaminhamentosSulamerica encaminhamentos={encaminhamentos} />
      </section>
    </div>
  );
}

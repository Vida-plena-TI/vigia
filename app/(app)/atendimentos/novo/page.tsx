import type { Metadata } from "next";

import {
  dataDeHoje,
  listarPacientesComGuiasDisponiveis,
} from "@/lib/domain/atendimentos";

import { FormularioDeAtendimento } from "./formulario-de-atendimento";

export const metadata: Metadata = {
  title: "Lançar atendimento | VIGIA",
};

/**
 * Lançamento de atendimento em lote (Prompt 6 / regras 6 e 7 do CONTEXT.md).
 *
 * Server Component: a lista de pacientes e a data de hoje são lidas aqui. As
 * guias **não** — elas dependem do paciente escolhido e são buscadas sob
 * demanda pela Server Function `carregarGuiasDoPaciente`. Mandar as guias de
 * todo mundo no HTML inicial encheria a página de dados que quase nunca são
 * usados, do mesmo jeito que o histórico de guia do dashboard.
 *
 * A autenticação é garantida pelo layout `app/(app)/layout.tsx`
 * (`requireUsuario`), além da triagem do `proxy.ts` — e de novo dentro de cada
 * Server Action, que é alcançável sem passar por nenhum dos dois.
 */
export default async function NovoAtendimentoPage() {
  // Independentes entre si: buscar em paralelo evita somar as duas idas ao
  // banco no tempo de resposta da página.
  const [pacientes, hoje] = await Promise.all([
    listarPacientesComGuiasDisponiveis(),
    dataDeHoje(),
  ]);

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Lançar atendimento
        </h1>
        <p className="text-sm text-muted-foreground">
          Só aparecem terapias com saldo. O lote inteiro é gravado em uma
          transação: se uma guia não tiver saldo, nenhum atendimento é lançado.
        </p>
      </div>

      <FormularioDeAtendimento pacientes={pacientes} hoje={hoje} />
    </div>
  );
}

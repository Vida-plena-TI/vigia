import type { Metadata } from "next";

import {
  listarNomesDePacientes,
  listarTerapias,
} from "@/lib/domain/requisicoes";

import { FormularioDeRequisicao } from "./formulario-de-requisicao";

export const metadata: Metadata = {
  title: "Nova requisição | VIGIA",
};

/**
 * Cadastro de nova requisição (Prompt 5 / regra 5 do CONTEXT.md).
 *
 * Server Component: as duas listas que o formulário precisa (pacientes para o
 * `datalist`, terapias para o `select`) são lidas aqui e vão prontas para o
 * cliente. O formulário em si é client-side porque a lista de terapias cresce
 * e encolhe por estado do React.
 *
 * A autenticação é garantida pelo layout `app/(app)/layout.tsx`
 * (`requireUsuario`), além da triagem do `proxy.ts` — e de novo dentro da
 * própria Server Action, que é alcançável sem passar por nenhum dos dois.
 */
export default async function NovaRequisicaoPage() {
  // Independentes entre si: buscar em paralelo evita somar as duas idas ao
  // banco no tempo de resposta da página.
  const [nomesDePacientes, terapias] = await Promise.all([
    listarNomesDePacientes(),
    listarTerapias(),
  ]);

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Nova requisição
        </h1>
        <p className="text-sm text-muted-foreground">
          O paciente, a requisição e as guias são gravados em uma única
          transação: se qualquer linha falhar, nada é criado.
        </p>
      </div>

      <FormularioDeRequisicao
        nomesDePacientes={nomesDePacientes}
        terapias={terapias}
      />
    </div>
  );
}

import type { Metadata } from "next";

import {
  dataDeHoje,
  listarAtendimentosDeHoje,
} from "@/lib/domain/atendimentos";

import { formatarData } from "../../dashboard/formato";

export const metadata: Metadata = {
  title: "Atendimentos de hoje | VIGIA",
};

/**
 * Lista simples dos atendimentos lançados hoje.
 *
 * A autenticação é garantida pelo layout `app/(app)/layout.tsx`
 * (`requireUsuario`), além da triagem do `proxy.ts`. A data de referência vem
 * do Postgres (`CURRENT_DATE`), não do relógio do navegador.
 *
 * Tela densa, como o painel: mesma folha pautada, mesma borda esquerda. A
 * diferença de largura em relação aos formulários é intencional.
 */
export default async function AtendimentosDeHojePage() {
  const [atendimentos, hoje] = await Promise.all([
    listarAtendimentosDeHoje(),
    dataDeHoje(),
  ]);

  return (
    <div className="flex w-full max-w-5xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-regua-forte pb-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Atendimentos de hoje</h1>
          <p className="text-sm text-muted-foreground">
            {formatarData(hoje)} · {atendimentos.length} atendimento(s)
            lançado(s).
          </p>
        </div>
      </div>

      {atendimentos.length === 0 ? (
        <p className="folha px-4 py-8 text-center text-sm text-muted-foreground">
          Nenhum atendimento lançado hoje.
        </p>
      ) : (
        <div className="folha overflow-hidden">
          <table className="hidden w-full border-collapse text-sm sm:table">
            <thead>
              <tr className="border-b border-regua-forte bg-secondary/60">
                <th scope="col" className={CLASSE_CABECALHO}>
                  Paciente
                </th>
                <th scope="col" className={CLASSE_CABECALHO}>
                  Terapia
                </th>
                <th scope="col" className={`${CLASSE_CABECALHO} w-24 text-right`}>
                  Créditos
                </th>
                <th scope="col" className={CLASSE_CABECALHO}>
                  Observação
                </th>
              </tr>
            </thead>

            <tbody>
              {atendimentos.map((atendimento) => (
                <tr
                  key={atendimento.id}
                  className="border-b border-regua last:border-b-0 hover:bg-secondary/40"
                >
                  <td className="px-3 py-2 font-medium">
                    {atendimento.pacienteNome}
                  </td>
                  <td className="px-3 py-2">{atendimento.terapiaNome}</td>
                  <td className="px-3 py-2 text-right font-semibold">
                    {atendimento.creditosConsumidos}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {atendimento.observacao ?? (
                      <span className="text-xs italic">sem observação</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Quatro colunas ainda não cabem num aparelho de mão. */}
          <ul className="divide-y divide-regua sm:hidden">
            {atendimentos.map((atendimento) => (
              <li key={atendimento.id} className="flex flex-col gap-1 px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-medium">
                    {atendimento.pacienteNome}
                  </p>
                  <p className="text-base font-semibold">
                    {atendimento.creditosConsumidos}
                    <span className="ml-1 text-2xs font-normal text-muted-foreground">
                      crédito(s)
                    </span>
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {atendimento.terapiaNome}
                </p>
                {atendimento.observacao ? (
                  <p className="text-xs">{atendimento.observacao}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Mesmo cabeçalho de coluna do painel: peso 500, cinza, caixa normal. */
const CLASSE_CABECALHO =
  "px-3 py-1.5 text-left text-2xs font-medium text-muted-foreground";

import type { Metadata } from "next";

import { dataDeHoje } from "@/lib/domain/atendimentos";
import { listarEncaminhamentos } from "@/lib/domain/encaminhamentos";
import { listarNomesDePacientes } from "@/lib/domain/pacientes";

import { formatarData } from "../dashboard/formato";
import { FormularioDeEncaminhamento } from "./formulario-de-encaminhamento";

export const metadata: Metadata = {
  title: "Encaminhamentos | VIGIA",
};

/**
 * Encaminhamentos: cadastro e listagem na **mesma** tela.
 *
 * Não há rota `/novo` nem diálogo. O formulário fica inline no topo e a
 * listagem logo abaixo; ao enviar, a Server Action chama `refresh()` e esta
 * página redesenha com o registro novo já no topo da lista, sem navegação.
 *
 * A largura é a das telas densas modestas (`max-w-5xl`, a mesma de
 * "Atendimentos de hoje"), não a de formulário (`max-w-[46rem]`): a tela é
 * majoritariamente uma lista, e o formulário é uma faixa dentro dela.
 *
 * A autenticação é garantida pelo layout `app/(app)/layout.tsx`
 * (`requireUsuario`), além da triagem do `proxy.ts` — e de novo dentro da
 * própria Server Action, que é alcançável sem passar por nenhum dos dois.
 */
export default async function EncaminhamentosPage() {
  // Independentes entre si: buscar em paralelo evita somar as três idas ao
  // banco no tempo de resposta da página.
  const [encaminhamentos, nomesDePacientes, hoje] = await Promise.all([
    listarEncaminhamentos(),
    listarNomesDePacientes(),
    dataDeHoje(),
  ]);

  return (
    <div className="flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-1 border-b border-regua-forte pb-4">
        <h1 className="text-2xl font-semibold">Encaminhamentos</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          O vencimento é calculado pelo banco: 180 dias corridos depois da data
          do encaminhamento.
        </p>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="regua-de-secao">Novo encaminhamento</h2>

        <FormularioDeEncaminhamento
          nomesDePacientes={nomesDePacientes}
          hoje={hoje}
        />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="regua-de-secao">
          Registrados
          <span className="text-sm font-normal text-muted-foreground">
            {encaminhamentos.length}
          </span>
        </h2>

        {encaminhamentos.length === 0 ? (
          <p className="folha px-4 py-8 text-center text-sm text-muted-foreground">
            Nenhum encaminhamento registrado ainda.
          </p>
        ) : (
          <div className="folha overflow-hidden">
            <table className="hidden w-full border-collapse text-sm sm:table">
              <thead>
                <tr className="border-b border-regua-forte bg-secondary/60">
                  <th scope="col" className={CLASSE_CABECALHO}>
                    Paciente
                  </th>
                  <th scope="col" className={`${CLASSE_CABECALHO} w-48`}>
                    Data do encaminhamento
                  </th>
                  <th scope="col" className={`${CLASSE_CABECALHO} w-48`}>
                    Vencimento
                  </th>
                </tr>
              </thead>

              <tbody>
                {encaminhamentos.map((encaminhamento) => (
                  <tr
                    key={encaminhamento.id}
                    className="border-b border-regua last:border-b-0 hover:bg-secondary/40"
                  >
                    <td className="px-3 py-2 font-medium">
                      {encaminhamento.pacienteNome}
                    </td>
                    <td className="px-3 py-2">
                      {formatarData(encaminhamento.dataEncaminhamento)}
                    </td>
                    <td className="px-3 py-2">
                      <Vencimento
                        data={encaminhamento.dataVencimento}
                        vencido={encaminhamento.vencido}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Abaixo de `sm` as três colunas viram blocos, como no painel. */}
            <ul className="divide-y divide-regua sm:hidden">
              {encaminhamentos.map((encaminhamento) => (
                <li
                  key={encaminhamento.id}
                  className="flex flex-col gap-1 px-4 py-3"
                >
                  <p className="text-sm font-medium">
                    {encaminhamento.pacienteNome}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Encaminhado em{" "}
                    {formatarData(encaminhamento.dataEncaminhamento)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Vence em{" "}
                    <Vencimento
                      data={encaminhamento.dataVencimento}
                      vencido={encaminhamento.vencido}
                    />
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * A data de vencimento, com destaque quando já passou.
 *
 * Não é uma quarta coluna nem um selo novo: é a mesma coluna de sempre, com o
 * tratamento que o sistema de design já reserva para "o próprio número é o
 * alerta" — o mesmo que o `saldo_restante <= 0` recebe no painel (carmim em
 * negrito). O `StatusBadge` foi deixado de fora de propósito: ele escreve o
 * rótulo literal ("Regular" / "Renovar" / "Esgotada"), e nenhum dos três diz o
 * que se quer dizer aqui.
 *
 * Como no resto do sistema, a cor não é o único canal: a palavra "vencido" vai
 * junto, dentro da mesma célula.
 */
function Vencimento({ data, vencido }: { data: string; vencido: boolean }) {
  if (!vencido) {
    return <>{formatarData(data)}</>;
  }

  return (
    <span className="font-semibold text-esgotada">
      {formatarData(data)}
      <span className="ml-1.5 text-2xs font-medium">vencido</span>
    </span>
  );
}

/** Mesmo cabeçalho de coluna do painel: peso 500, cinza, caixa normal. */
const CLASSE_CABECALHO =
  "px-3 py-1.5 text-left text-2xs font-medium text-muted-foreground";

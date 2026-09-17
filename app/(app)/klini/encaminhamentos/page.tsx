import type { Metadata } from "next";

import { dataDeHoje } from "@/lib/domain/atendimentos";
import {
  contarPorStatusDeEncaminhamento,
  listarEncaminhamentos,
} from "@/lib/domain/encaminhamentos";
import { listarNomesDePacientes } from "@/lib/domain/pacientes";

import { FormularioDeEncaminhamento } from "./formulario-de-encaminhamento";
import { ListaDeEncaminhamentos } from "./lista-de-encaminhamentos";
import { ResumoDeVencimentos } from "./resumo-de-vencimentos";

export const metadata: Metadata = {
  title: "Encaminhamentos | VIGIA",
};

/**
 * Encaminhamentos: cadastro e listagem na **mesma** tela.
 *
 * Não há rota `/novo` nem diálogo. O formulário fica inline no topo e a
 * listagem logo abaixo; ao enviar, a Server Action chama `refresh()` e esta
 * página redesenha com o registro novo já no topo da lista, sem navegação — e,
 * quando o paciente já tinha um encaminhamento, sem a linha antiga, que o
 * upsert substituiu.
 *
 * A ordem vertical é a mesma do painel: resumo de contagem, depois a lista. O
 * formulário vem antes dos dois porque digitar é o que se faz aqui com mais
 * frequência, e ele é uma faixa curta.
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
          do encaminhamento. Cada paciente tem um encaminhamento só — cadastrar
          outro substitui o anterior. Sem encaminhamento cadastrado, o paciente
          não pode receber requisição.
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

        <ResumoDeVencimentos
          resumo={contarPorStatusDeEncaminhamento(encaminhamentos)}
        />

        <ListaDeEncaminhamentos encaminhamentos={encaminhamentos} />
      </section>
    </div>
  );
}

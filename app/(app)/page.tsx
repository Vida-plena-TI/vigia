import Link from "next/link";
import { redirect } from "next/navigation";

import { ROTA_PADRAO_DA_RECEPCAO } from "@/lib/auth/acesso";
import { requireUsuario } from "@/lib/auth/current-user";

/**
 * A raiz é a escolha de convênio — para quem tem mais de um.
 *
 * Até a Fase B ela só redirecionava para `/klini/dashboard`. Com a Fase C ela
 * ramifica por papel:
 *
 * - `admin` vê os dois convênios e escolhe;
 * - `recepcao` vai direto para o painel do Klini, sem ver a escolha: ela não
 *   tem escolha para fazer, e uma tela com uma opção só é um clique inútil.
 *
 * O papel vem de `requireUsuario()`, ou seja, do banco — o layout já chamou a
 * mesma função nesta requisição e o `cache` do React devolve a leitura dele,
 * sem segunda ida ao Postgres.
 *
 * O cartão da SulAmérica já aponta para `/sulamerica/dashboard`, que ainda não
 * existe (Fase D): o destino é o definitivo desde agora para o link não ter de
 * mudar depois.
 */
export default async function HomePage() {
  const usuario = await requireUsuario();

  if (usuario.papel !== "admin") {
    redirect(ROTA_PADRAO_DA_RECEPCAO);
  }

  return (
    <div className="flex w-full max-w-[46rem] flex-col gap-7">
      <div className="flex flex-col gap-1 border-b border-regua-forte pb-4">
        <h1 className="text-xl font-semibold">Convênios</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Escolha o convênio para abrir o painel dele. Cada convênio tem as
          próprias requisições, guias e atendimentos.
        </p>
      </div>

      {/*
        Dois cartões, não uma lista de links: a escolha é a única coisa nesta
        tela, e o alvo de clique grande é o que ela merece. Sem cor — convênio
        não é status, e cor no VIGIA é reservada para status.
      */}
      <ul className="grid gap-4 sm:grid-cols-2">
        <CartaoDeConvenio
          href="/klini/dashboard"
          nome="Klini"
          descricao="Requisições, guias, atendimentos e encaminhamentos."
        />
        <CartaoDeConvenio
          href="/sulamerica/dashboard"
          nome="SulAmérica"
          descricao="Em construção."
        />
      </ul>
    </div>
  );
}

function CartaoDeConvenio({
  href,
  nome,
  descricao,
}: {
  href: string;
  nome: string;
  descricao: string;
}) {
  return (
    <li className="flex">
      <Link
        href={href}
        className="folha flex flex-1 flex-col gap-1.5 px-4 py-4 transition-colors hover:border-regua-forte hover:bg-secondary/40"
      >
        <span className="font-serif text-lg leading-none font-semibold tracking-[-0.01em]">
          {nome}
        </span>
        <span className="text-sm text-muted-foreground">{descricao}</span>
      </Link>
    </li>
  );
}

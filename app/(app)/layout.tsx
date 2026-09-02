import { headers } from "next/headers";
import Link from "next/link";

import { requireUsuario } from "@/lib/auth/current-user";
import { PATHNAME_HEADER } from "@/lib/auth/pathname-header";
import { Toaster } from "@/components/ui/sonner";

import { Navegacao } from "./navegacao";

/**
 * Layout das rotas autenticadas.
 *
 * Toda pagina dentro de `app/(app)/` passa por aqui, e `requireUsuario` e a
 * checagem que vale: confirma no banco que o usuario da sessao existe e esta
 * ativo. O `proxy.ts` so faz a triagem otimista pelo cookie.
 *
 * Visualmente: a faixa grafite fixa no topo é o "posto de vigia" — ela ancora
 * todas as telas e é o único elemento escuro dentro do sistema. Dentro dela o
 * anel de foco vira claro (`--anel-foco`), senão um contorno grafite sobre
 * fundo grafite seria invisível para quem navega por teclado.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const cabecalhos = await headers();
  const usuario = await requireUsuario(cabecalhos.get(PATHNAME_HEADER));

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header
        className="bg-grafite text-white"
        style={{ ["--anel-foco" as string]: "#ffffff" }}
      >
        <div className="mx-auto flex w-full max-w-[90rem] flex-col gap-2 px-5 py-2.5 sm:flex-row sm:items-center sm:gap-6 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <Link
              href="/dashboard"
              className="font-serif text-xl leading-none font-semibold tracking-[-0.01em] text-white"
            >
              VIGIA
            </Link>

            <div className="flex items-center gap-3 sm:hidden">
              <IdentificacaoDoUsuario username={usuario.username} />
            </div>
          </div>

          <Navegacao />

          <div className="ml-auto hidden items-center gap-3 sm:flex">
            <IdentificacaoDoUsuario username={usuario.username} />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[90rem] flex-1 flex-col px-5 py-6 sm:px-6 sm:py-8">
        {children}
      </main>

      {/*
        Um unico `Toaster` para todas as rotas autenticadas. Montar um por
        pagina faria toasts duplicados durante a transicao entre rotas.
      */}
      <Toaster position="top-right" richColors />
    </div>
  );
}

/** Quem está logado e a saída. Texto simples: não é uma ação de destaque. */
function IdentificacaoDoUsuario({ username }: { username: string }) {
  return (
    <>
      <span className="text-xs text-[#a8b4c4]">{username}</span>
      <form action="/api/auth/logout" method="post" className="flex">
        <button
          type="submit"
          className="rounded-sm border border-[#3a4757] px-2 py-1 text-xs font-medium text-[#d6dde6] transition-colors hover:border-[#6d7d90] hover:text-white"
        >
          Sair
        </button>
      </form>
    </>
  );
}

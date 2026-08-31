import { headers } from "next/headers";
import Link from "next/link";

import { requireUsuario } from "@/lib/auth/current-user";
import { PATHNAME_HEADER } from "@/lib/auth/pathname-header";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";

/**
 * Layout das rotas autenticadas.
 *
 * Toda pagina dentro de `app/(app)/` passa por aqui, e `requireUsuario` e a
 * checagem que vale: confirma no banco que o usuario da sessao existe e esta
 * ativo. O `proxy.ts` so faz a triagem otimista pelo cookie.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const cabecalhos = await headers();
  const usuario = await requireUsuario(cabecalhos.get(PATHNAME_HEADER));

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between gap-4 border-b px-6 py-3">
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/" className="font-semibold">
            klini
          </Link>
          <Link
            href="/requisicoes/nova"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Nova requisicao
          </Link>
          <Link
            href="/atendimentos/novo"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Lançar atendimento
          </Link>
          <Link
            href="/atendimentos/hoje"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Atendimentos de hoje
          </Link>
        </nav>

        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">{usuario.username}</span>
          <form action="/api/auth/logout" method="post">
            <Button type="submit" variant="outline" size="sm">
              Sair
            </Button>
          </form>
        </div>
      </header>

      <main className="flex flex-1 flex-col p-6">{children}</main>

      {/*
        Um unico `Toaster` para todas as rotas autenticadas. Montar um por
        pagina faria toasts duplicados durante a transicao entre rotas.
      */}
      <Toaster position="top-right" richColors />
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { PapelUsuario } from "@/lib/auth/papel";
import { cn } from "@/lib/utils";

import { itensDeNavegacaoPara } from "./itens-de-navegacao";

/**
 * Navegação da faixa escura.
 *
 * A rota ativa é marcada por um filete branco embaixo do rótulo, não por uma
 * pílula colorida: dentro do VIGIA, cor é reservada para status, e um item de
 * menu não é um status.
 *
 * Os itens dependem do convênio atual e do `papel` (Fase C) — ver
 * `itensDeNavegacaoPara`. O papel
 * chega por prop, do layout, que já o leu do banco: um client component não
 * tem como fazer essa leitura, e o cookie é `httpOnly`.
 */
export function Navegacao({
  papel,
  pathnameInicial,
}: {
  papel: PapelUsuario;
  pathnameInicial: string;
}) {
  // Reutiliza o pathname já lido para o destaque ativo. O layout é preservado
  // entre navegações: usar só o header deixaria o menu no convênio anterior.
  const pathname = usePathname() ?? pathnameInicial;
  const itens = itensDeNavegacaoPara(papel, pathname);

  if (itens.length === 0) return null;

  return (
    <nav
      aria-label="Seções do VIGIA"
      // A rolagem horizontal é o que salva a faixa no celular: os cinco
      // rótulos do admin não cabem em 360px e quebrar linha empurraria o
      // conteúdo.
      className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:overflow-x-auto sm:px-0"
    >
      <ul className="flex items-stretch gap-1 whitespace-nowrap">
        {itens.map((item) => {
          const ativo =
            pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <li key={item.href} className="flex">
              <Link
                href={item.href}
                aria-current={ativo ? "page" : undefined}
                className={cn(
                  "flex items-center border-b-2 px-2.5 py-1 text-sm font-medium transition-colors",
                  ativo
                    ? "border-white text-white"
                    : "border-transparent text-[#a8b4c4] hover:border-[#a8b4c4] hover:text-white",
                )}
              >
                {item.rotulo}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

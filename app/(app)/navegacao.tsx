"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * Itens da faixa de navegação.
 *
 * Os rótulos batem exatamente com o `<h1>` de cada página — acentuação
 * incluída. Divergir aqui faz o usuário achar que chegou em outro lugar.
 */
const ITENS = [
  { href: "/dashboard", rotulo: "Painel" },
  { href: "/requisicoes/nova", rotulo: "Nova requisição" },
  { href: "/atendimentos/novo", rotulo: "Lançar atendimento" },
  { href: "/atendimentos/hoje", rotulo: "Atendimentos de hoje" },
] as const;

/**
 * Navegação da faixa escura.
 *
 * A rota ativa é marcada por um filete branco embaixo do rótulo, não por uma
 * pílula colorida: dentro do VIGIA, cor é reservada para status, e um item de
 * menu não é um status.
 */
export function Navegacao() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Seções do VIGIA"
      // A rolagem horizontal é o que salva a faixa no celular: os quatro
      // rótulos não cabem em 360px e quebrar linha empurraria o conteúdo.
      className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:overflow-visible sm:px-0"
    >
      <ul className="flex items-stretch gap-1 whitespace-nowrap">
        {ITENS.map((item) => {
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

"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";

/**
 * Toast de "requisição criada", disparado pelo `?criada=...` que a Server
 * Action coloca na URL do redirect.
 *
 * O aviso viaja pela URL porque o `redirect` de uma Server Action troca a
 * página inteira: qualquer estado que o formulário guardasse morre no caminho.
 *
 * Depois de avisar, a query é apagada com `replace`. Sem isso o toast voltaria
 * a aparecer a cada recarga da página, e o usuário levaria o `?criada=` junto
 * ao favoritar o dashboard.
 *
 * Não renderiza nada: quem desenha o toast é o `<Toaster />` do layout.
 */
export function AvisoDeCriacao({
  numeroRequisicao,
  pacienteNome,
}: {
  numeroRequisicao: string;
  pacienteNome: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const jaAvisou = useRef(false);

  useEffect(() => {
    // O StrictMode roda o efeito duas vezes em desenvolvimento; sem a trava o
    // usuário veria dois toasts iguais.
    if (jaAvisou.current) {
      return;
    }

    jaAvisou.current = true;

    toast.success(`Requisição ${numeroRequisicao} criada.`, {
      description: pacienteNome
        ? `As guias já aparecem na lista de ${pacienteNome}.`
        : undefined,
    });

    router.replace(pathname);
  }, [numeroRequisicao, pacienteNome, pathname, router]);

  return null;
}

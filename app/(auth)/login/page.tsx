import { redirect } from "next/navigation";

import { getUsuarioAtual } from "@/lib/auth/current-user";
import { safeNextPath } from "@/lib/auth/next-path";

import { LoginForm } from "./login-form";

export const metadata = {
  title: "Entrar | VIGIA",
};

export default async function LoginPage(props: PageProps<"/login">) {
  const { next } = await props.searchParams;
  const destino = safeNextPath(typeof next === "string" ? next : null);

  // Ja logado: nao faz sentido mostrar o formulario.
  const usuario = await getUsuarioAtual();

  if (usuario) {
    redirect(destino ?? "/");
  }

  return (
    /*
      A única tela escura do sistema, de propósito: dentro do VIGIA o fundo é
      papel, e aqui é grafite. Dá para saber que se está fora do sistema antes
      de ler qualquer palavra — inclusive de relance, no meio do expediente.
    */
    <main
      className="flex flex-1 flex-col items-center justify-center gap-6 bg-grafite px-5 py-12"
      style={{ ["--anel-foco" as string]: "#ffffff" }}
    >
      <div className="flex flex-col items-center gap-1.5 text-center">
        <p className="font-serif text-4xl leading-none font-semibold tracking-[-0.01em] text-white">
          VIGIA
        </p>
        <p className="text-xs text-[#a8b4c4]">
          Controle de autorizações de terapia
        </p>
      </div>

      <LoginForm next={destino ?? undefined} />
    </main>
  );
}

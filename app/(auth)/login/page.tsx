import { redirect } from "next/navigation";

import { getUsuarioAtual } from "@/lib/auth/current-user";
import { safeNextPath } from "@/lib/auth/next-path";

import { LoginForm } from "./login-form";

export const metadata = {
  title: "Entrar | klini",
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
    <main className="flex flex-1 items-center justify-center bg-muted/40 p-6">
      <LoginForm next={destino ?? undefined} />
    </main>
  );
}

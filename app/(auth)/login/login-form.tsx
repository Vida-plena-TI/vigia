"use client";

import { useActionState } from "react";

import { login, type LoginState } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ESTADO_INICIAL: LoginState = {};

/**
 * Formulário de entrada.
 *
 * Sem cartão do shadcn: a folha branca já é o único objeto sobre o fundo
 * grafite, e este é o caso legítimo de elevação do sistema — algo que de fato
 * flutua sozinho, não mais uma seção decorada.
 */
export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(login, ESTADO_INICIAL);

  return (
    <div
      className="w-full max-w-[22rem] rounded-2xl bg-card p-6 shadow-[0_18px_40px_-12px_rgb(0_0_0/0.55)]"
      // Dentro da folha branca o anel de foco volta a ser grafite; o branco
      // herdado do fundo escuro sumiria aqui.
      style={{ ["--anel-foco" as string]: "var(--grafite)" }}
    >
      <form action={action} className="flex flex-col gap-5">
        {next ? <input type="hidden" name="next" value={next} /> : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="username" className="text-xs">
            Usuário
          </Label>
          <Input
            id="username"
            name="username"
            autoComplete="username"
            autoFocus
            required
            className="h-10"
            defaultValue={state.username ?? ""}
            aria-invalid={state.erro ? true : undefined}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password" className="text-xs">
            Senha
          </Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="h-10"
            aria-invalid={state.erro ? true : undefined}
          />
        </div>

        {state.erro ? (
          <p role="alert" className="aviso-de-erro">
            {state.erro}
          </p>
        ) : null}

        <Button type="submit" disabled={pending} className="h-10 w-full">
          {pending ? "Entrando..." : "Entrar"}
        </Button>
      </form>
    </div>
  );
}

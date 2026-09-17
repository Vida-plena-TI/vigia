import { redirect } from "next/navigation";

/**
 * A raiz não duplica o dashboard: ela redireciona para ele.
 *
 * O dashboard vive em `/klini/dashboard` como rota própria, para ter URL
 * própria e poder ser linkado (o `next=` do login, por exemplo). O segmento
 * `klini` é o convênio: tudo que é fluxo klini mora debaixo dele.
 */
export default function HomePage() {
  redirect("/klini/dashboard");
}

import { redirect } from "next/navigation";

/**
 * A raiz não duplica o dashboard: ela redireciona para ele.
 *
 * O dashboard vive em `/dashboard` como rota própria, para ter URL própria e
 * poder ser linkado (o `next=` do login, por exemplo).
 */
export default function HomePage() {
  redirect("/dashboard");
}

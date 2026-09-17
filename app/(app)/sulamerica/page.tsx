import { redirect } from "next/navigation";
import { ROTA_SULAMERICA } from "@/lib/auth/acesso";
import { requireAcessoARota } from "@/lib/auth/current-user";

export default async function SulamericaInicio() {
  await requireAcessoARota(ROTA_SULAMERICA, "/sulamerica");
  redirect(ROTA_SULAMERICA);
}

import type { Metadata } from "next";
import { headers } from "next/headers";

import { CabecalhoDoCadastro } from "@/components/cadastro-de-paciente/cabecalho-do-cadastro";
import { TelaDeCadastro } from "@/components/cadastro-de-paciente/tela-de-cadastro";
import {
  ROTA_SULAMERICA_ENCAMINHAMENTOS,
  ROTA_SULAMERICA_PACIENTES,
} from "@/lib/auth/acesso";
import { requireAcessoARota } from "@/lib/auth/current-user";
import { PATHNAME_HEADER } from "@/lib/auth/pathname-header";
import {
  listarPacientesDoConvenio,
  listarTerapias,
} from "@/lib/domain/plano-terapias";

export const metadata: Metadata = { title: "Cadastro SulAmérica | VIGIA" };

/**
 * Aba Cadastro da SulAmérica — mesmo desenho da da Klini (ver
 * `app/(app)/klini/pacientes/page.tsx`), com o convênio `sulamerica`.
 */
export default async function CadastroSulamericaPage() {
  await requireAcessoARota(
    ROTA_SULAMERICA_PACIENTES,
    (await headers()).get(PATHNAME_HEADER),
  );

  const [pacientes, terapias] = await Promise.all([
    listarPacientesDoConvenio("sulamerica"),
    listarTerapias(),
  ]);

  return (
    <div className="flex w-full max-w-5xl flex-col gap-6">
      <CabecalhoDoCadastro
        nomeDoConvenio="SulAmérica"
        rotaDosEncaminhamentos={ROTA_SULAMERICA_ENCAMINHAMENTOS}
      />
      <TelaDeCadastro convenio="sulamerica" terapias={terapias} pacientes={pacientes} />
    </div>
  );
}

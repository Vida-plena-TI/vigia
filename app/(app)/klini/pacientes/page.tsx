import type { Metadata } from "next";
import { headers } from "next/headers";

import { CabecalhoDoCadastro } from "@/components/cadastro-de-paciente/cabecalho-do-cadastro";
import { TelaDeCadastro } from "@/components/cadastro-de-paciente/tela-de-cadastro";
import { ROTA_ENCAMINHAMENTOS, ROTA_KLINI_PACIENTES } from "@/lib/auth/acesso";
import { requireAcessoARota } from "@/lib/auth/current-user";
import { PATHNAME_HEADER } from "@/lib/auth/pathname-header";
import {
  listarPacientesDoConvenio,
  listarTerapias,
} from "@/lib/domain/plano-terapias";

export const metadata: Metadata = { title: "Cadastro Klini | VIGIA" };

/**
 * Aba Cadastro da Klini: a única porta de entrada do paciente da Klini (regra
 * 24). Formulário no topo, lista dos pacientes da Klini abaixo.
 *
 * Só admin: `requireAcessoARota` relê o papel no banco **antes** de qualquer
 * leitura — o desvio do `proxy.ts` é otimista. A action reconfirma por conta
 * própria. O convênio gravado é o desta página.
 */
export default async function CadastroKliniPage() {
  await requireAcessoARota(
    ROTA_KLINI_PACIENTES,
    (await headers()).get(PATHNAME_HEADER),
  );

  const [pacientes, terapias] = await Promise.all([
    listarPacientesDoConvenio("klini"),
    listarTerapias(),
  ]);

  return (
    <div className="flex w-full max-w-5xl flex-col gap-6">
      <CabecalhoDoCadastro
        nomeDoConvenio="Klini"
        rotaDosEncaminhamentos={ROTA_ENCAMINHAMENTOS}
      />
      <TelaDeCadastro convenio="klini" terapias={terapias} pacientes={pacientes} />
    </div>
  );
}

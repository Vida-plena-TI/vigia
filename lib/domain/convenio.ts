/**
 * Convênio do paciente (`paciente.convenio`, desde 29/10/2026).
 *
 * Espelho em TypeScript do `CHECK ("convenio" IN ('klini', 'sulamerica'))` da
 * migration `20261029120000_convenio_e_plano_de_terapias` — como `PAPEIS` em
 * `lib/auth/papel.ts` e `SITUACOES_DE_REQUISICAO`. Acrescentar um convênio é
 * mudar os dois no mesmo commit.
 *
 * Módulo sem import de banco: o formulário de cadastro (Client Component)
 * importa daqui.
 *
 * Na tabela o convênio é opcional: NULL é "ainda não decidido" (paciente sem
 * cadastro de convênio, ou com encaminhamento e autorização ao mesmo tempo).
 */

export const CONVENIOS = ["klini", "sulamerica"] as const;

export type Convenio = (typeof CONVENIOS)[number];

export function ehConvenioValido(valor: unknown): valor is Convenio {
  return (CONVENIOS as readonly unknown[]).includes(valor);
}

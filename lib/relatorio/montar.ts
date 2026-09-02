import {
  agruparPorPaciente,
  listarGuiasDoDashboard,
  type GuiaDoDashboard,
  type PacienteComGuias,
} from "@/lib/domain/guias";

const STATUS_QUE_ENTRAM_NO_RELATORIO = new Set<
  GuiaDoDashboard["statusAlerta"]
>(["Renovar", "Esgotada"]);

export type PacienteDoRelatorioSemanal = PacienteComGuias;

/** Uma guia dispara o relatório quando precisa renovar ou já esgotou. */
export function guiaDisparaRelatorio(
  guia: Pick<GuiaDoDashboard, "statusAlerta">,
): boolean {
  return STATUS_QUE_ENTRAM_NO_RELATORIO.has(guia.statusAlerta);
}

/**
 * Mantém os pacientes que têm pelo menos uma guia em alerta.
 *
 * As guias do paciente são preservadas como vieram do dashboard; o filtro é no
 * paciente, não numa segunda consulta.
 */
export function filtrarPacientesComGuiasEmAlerta(
  pacientes: readonly PacienteComGuias[],
): PacienteDoRelatorioSemanal[] {
  return pacientes.filter((paciente) =>
    paciente.guias.some(guiaDisparaRelatorio),
  );
}

/**
 * Monta o relatório semanal reaproveitando a mesma leitura do dashboard.
 *
 * Saldo e status vêm da view `requisicao_terapia_saldo` por
 * `listarGuiasDoDashboard`; este módulo só agrupa e filtra a lista final.
 */
export async function montarRelatorioSemanal(): Promise<
  PacienteDoRelatorioSemanal[]
> {
  return filtrarPacientesComGuiasEmAlerta(
    agruparPorPaciente(await listarGuiasDoDashboard()),
  );
}

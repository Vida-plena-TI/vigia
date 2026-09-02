/**
 * Regras de apresentação das guias no painel.
 *
 * Módulo sem nenhum import de banco, pelo mesmo motivo de
 * `requisicoes-mensagens.ts` e `atendimentos-mensagens.ts`: o painel é um
 * Client Component, e importar `lib/domain/guias.ts` de lá arrastaria o Prisma
 * para o bundle do navegador.
 *
 * Nada aqui recalcula saldo nem status — as funções só resumem o que a view
 * `requisicao_terapia_saldo` já decidiu. Ficam em `lib/` (e não junto do
 * componente) porque é o que o `include` do Vitest enxerga: são as duas peças
 * do recolhimento que dependem de ordem/precedência e merecem teste.
 */
import type { StatusAlerta } from "./saldo";

/**
 * Precedência do CONTEXT.md ("Campos calculados"): Esgotada > Renovar >
 * Regular. Também é a ordem em que o resumo do topo do painel é exibido, do
 * mais urgente para o menos.
 */
export const STATUS_EM_ORDEM_DE_URGENCIA: readonly StatusAlerta[] = [
  "Esgotada",
  "Renovar",
  "Regular",
];

/** O mínimo que uma guia precisa ter para o cabeçalho do paciente resumi-la. */
type GuiaResumivel = {
  statusAlerta: StatusAlerta;
  requisicaoId: number;
  numeroRequisicao: string;
};

/**
 * O status mais urgente entre as guias de um paciente.
 *
 * É o que permite varrer a lista com todos os pacientes recolhidos: o selo do
 * cabeçalho mostra o pior caso, então nenhum "Esgotada" fica escondido dentro
 * de um paciente fechado.
 *
 * Devolve `null` só para lista vazia — situação que o painel não produz (um
 * paciente só aparece porque tem guia), mas que a função não deve fingir que
 * é "Regular".
 */
export function piorStatus(
  guias: readonly Pick<GuiaResumivel, "statusAlerta">[],
): StatusAlerta | null {
  for (const status of STATUS_EM_ORDEM_DE_URGENCIA) {
    if (guias.some((guia) => guia.statusAlerta === status)) {
      return status;
    }
  }

  return null;
}

/**
 * O `numero_requisicao` a usar ao copiar o paciente.
 *
 * Na prática todas as guias de um paciente vêm da mesma requisição e qualquer
 * uma serviria. Mas o schema não impede um paciente de ter mais de uma
 * (`requisicao` é única por `(paciente_id, numero_requisicao)`, não por
 * paciente), então a escolha precisa ser determinística em vez de depender da
 * ordem em que as guias chegaram: vale a requisição mais recente, ou seja, a
 * de maior `requisicao_id`.
 *
 * É salvaguarda, não funcionalidade — a interface não expõe esse caso.
 */
export function numeroDaRequisicaoMaisRecente(
  guias: readonly Pick<GuiaResumivel, "requisicaoId" | "numeroRequisicao">[],
): string | null {
  let escolhida: Pick<
    GuiaResumivel,
    "requisicaoId" | "numeroRequisicao"
  > | null = null;

  for (const guia of guias) {
    if (!escolhida || guia.requisicaoId > escolhida.requisicaoId) {
      escolhida = guia;
    }
  }

  return escolhida?.numeroRequisicao ?? null;
}

/**
 * O texto que vai para a área de transferência.
 *
 * Formato exato combinado: `"Nome completo do paciente - Numero da
 * requisição"`, com hífen entre espaços. Sem requisição nenhuma (lista vazia)
 * sobra só o nome, para o botão nunca copiar um sufixo pendurado.
 */
export function textoDeCopia(
  nome: string,
  guias: readonly Pick<GuiaResumivel, "requisicaoId" | "numeroRequisicao">[],
): string {
  const numero = numeroDaRequisicaoMaisRecente(guias);

  return numero ? `${nome} - ${numero}` : nome;
}

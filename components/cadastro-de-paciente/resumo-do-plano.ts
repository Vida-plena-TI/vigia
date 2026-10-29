import type { TerapiaDoPlano } from "@/lib/domain/plano-terapias";
import { formatarMinutosSemanais } from "@/lib/domain/tempo-semanal";

/**
 * O plano em uma linha, para a lista da aba Cadastro: "Fono 2 h · TO 1 h 30
 * min", na ordem em que o banco devolveu (nome da terapia). `null` para quem
 * não tem plano (paciente antigo), que a tela mostra como "Plano não
 * cadastrado".
 *
 * Só formata o que está gravado: nada é somado nem arredondado (regra 23).
 */
export function resumirPlano(
  plano: readonly Pick<TerapiaDoPlano, "terapiaNome" | "minutosSemanais">[],
): string | null {
  if (plano.length === 0) {
    return null;
  }

  return plano
    .map(
      (terapia) =>
        `${terapia.terapiaNome} ${formatarMinutosSemanais(terapia.minutosSemanais)}`,
    )
    .join(" · ");
}

export const SEM_PLANO = "Plano não cadastrado";

import { useId } from "react";
import Link from "next/link";

import type { TerapiaDoPlano } from "@/lib/domain/plano-terapias";
import { formatarMinutosSemanais } from "@/lib/domain/tempo-semanal";

/** "Fono — 2 h 30 min por semana". */
export function textoDaTerapiaDoPlano(terapia: TerapiaDoPlano): string {
  return `${terapia.terapiaNome} — ${formatarMinutosSemanais(terapia.minutosSemanais)} por semana`;
}

/**
 * O plano semanal do paciente, dentro do painel aberto (regra 23).
 *
 * Só informativo, como o plano: uma linha por terapia, sem total e sem
 * comparar com autorizado ou saldo — quem quiser cruzar os dois olha a tabela
 * logo acima.
 *
 * `rotaDoCadastro` só vem para quem pode abrir a aba Cadastro (o admin); para
 * a recepção é `null` e o paciente sem plano mostra só o texto.
 */
export function PlanoSemanal({
  plano,
  rotaDoCadastro,
}: {
  plano: readonly TerapiaDoPlano[];
  rotaDoCadastro: string | null;
}) {
  const idTitulo = useId();

  return (
    <section
      aria-labelledby={idTitulo}
      className="flex flex-col gap-1 border-t border-regua-forte border-l-[3px] border-l-transparent px-4 py-3 md:px-3"
    >
      <h3 id={idTitulo} className="text-2xs font-medium text-muted-foreground">
        Plano semanal
      </h3>

      {plano.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-sm break-words">
          {plano.map((terapia) => (
            <li key={terapia.terapiaId}>{textoDaTerapiaDoPlano(terapia)}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Plano semanal não cadastrado.
          {rotaDoCadastro ? (
            <>
              {" "}
              <Link
                href={rotaDoCadastro}
                className="font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground"
              >
                Cadastrar plano
              </Link>
            </>
          ) : null}
        </p>
      )}
    </section>
  );
}

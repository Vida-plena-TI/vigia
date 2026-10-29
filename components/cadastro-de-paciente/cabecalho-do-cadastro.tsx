import Link from "next/link";

/**
 * Cabeçalho das duas abas Cadastro (Klini e SulAmérica), com o "Trocar
 * convênio" das outras telas do admin.
 */
export function CabecalhoDoCadastro({
  nomeDoConvenio,
  rotaDosEncaminhamentos,
}: {
  nomeDoConvenio: string;
  rotaDosEncaminhamentos: string;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-regua-forte pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Cadastro {nomeDoConvenio}</h1>
        <Link
          href="/"
          className="text-sm font-medium underline underline-offset-4 hover:text-muted-foreground"
        >
          Trocar convênio
        </Link>
      </div>
      <p className="max-w-prose text-sm text-muted-foreground">
        Todo paciente do convênio entra por aqui, com o plano de terapias por
        semana. O plano é só informativo: não muda saldo, guia nem atendimento.
        Depois de cadastrado, o paciente recebe encaminhamento na aba{" "}
        <Link
          href={rotaDosEncaminhamentos}
          className="font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground"
        >
          Encaminhamentos
        </Link>
        .
      </p>
    </div>
  );
}

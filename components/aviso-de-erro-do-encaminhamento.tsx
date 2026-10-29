import Link from "next/link";

import { ehErroQueLevaAoCadastro } from "@/lib/domain/pacientes-mensagens";

/**
 * O aviso de erro dos dois formulários de encaminhamento (Klini e
 * SulAmérica). Quando a recusa se resolve cadastrando o paciente — nome de
 * ninguém, ou paciente sem convênio (regra 24) —, a frase vem com o link para
 * a aba Cadastro do mesmo convênio.
 */
export function AvisoDeErroDoEncaminhamento({
  erro,
  rotaDoCadastro,
}: {
  erro: string;
  rotaDoCadastro: string;
}) {
  return (
    <p role="alert" className="aviso-de-erro">
      {erro}
      {ehErroQueLevaAoCadastro(erro) ? (
        <>
          {" "}
          <Link
            href={rotaDoCadastro}
            className="font-medium underline underline-offset-4"
          >
            Ir para Cadastro
          </Link>
        </>
      ) : null}
    </p>
  );
}

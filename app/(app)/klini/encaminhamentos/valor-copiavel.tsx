"use client";

import { BotaoDeCopiar } from "@/components/botao-de-copiar";

/** Os dois dados do paciente que a lista mostra com botão de copiar. */
export type CampoCopiavel = "carteirinha" | "crm";

const NOME_DO_CAMPO: Record<
  CampoCopiavel,
  { rotulo: string; titulo: string; copiado: string }
> = {
  carteirinha: {
    rotulo: "carteirinha",
    titulo: "Carteirinha",
    copiado: "copiada",
  },
  crm: { rotulo: "CRM", titulo: "CRM", copiado: "copiado" },
};

/**
 * Carteirinha ou CRM de uma linha de Encaminhamentos: o número por escrito e,
 * ao lado, um botão que copia **só** o número — um botão por campo, para quem
 * cola no portal do convênio não ter de apagar rótulo nem o outro número.
 *
 * O valor vem do que a página já recebeu de `listarEncaminhamentos`; a cópia é
 * feita no navegador, sem ida ao servidor e sem rota que devolva o número.
 *
 * Paciente cadastrado antes de 28/10/2026 tem os dois campos nulos (regra 20).
 * A célula diz "falta preencher" por escrito — não só um traço, não só cor — e
 * o botão fica desabilitado, porque copiar nada colaria texto vazio sem aviso.
 * Como completar está na dica acima da lista, uma vez só.
 */
export function ValorCopiavel({
  campo,
  valor,
  pacienteNome,
  forma,
}: {
  campo: CampoCopiavel;
  valor: string | null;
  pacienteNome: string;
  /**
   * `tabela`: só o número, porque o cabeçalho da coluna já diz qual campo é.
   * `bloco`: celular — "Carteirinha:" / "CRM:" por escrito antes do número.
   * O botão é o mesmo nas duas: só o ícone.
   */
  forma: "tabela" | "bloco";
}) {
  const nome = NOME_DO_CAMPO[campo];
  // O banco já grava normalizado; o `trim` é só para nunca colar espaço.
  const texto = valor?.trim() ?? "";
  const faltaPreencher = texto === "";
  const rotuloAcessivel = `Copiar ${nome.rotulo} de ${pacienteNome}`;

  return (
    <div
      // Número e ícone colados (`gap-x-1`): o botão é do número ao lado dele.
      className="flex flex-wrap items-center gap-x-1 gap-y-0.5"
    >
      <span className="min-w-0 text-sm">
        {forma === "bloco" ? (
          <span className="text-xs text-muted-foreground">{nome.titulo}: </span>
        ) : null}
        {faltaPreencher ? (
          <span className="text-muted-foreground">
            <span aria-hidden>— </span>
            falta preencher
          </span>
        ) : (
          <span className="break-all">{texto}</span>
        )}
      </span>

      {/*
        Só o ícone, como no painel. Quem não enxerga ouve o `aria-label`; quem
        usa mouse vê o mesmo texto no `title`. 36×36px (`icon-lg`) na tabela e
        nos blocos: menor que isso o dedo erra no celular.
      */}
      <BotaoDeCopiar
        texto={texto}
        rotuloAcessivel={rotuloAcessivel}
        title={rotuloAcessivel}
        aviso={`${nome.titulo} de ${pacienteNome} ${nome.copiado}.`}
        disabled={faltaPreencher}
        size="icon-lg"
      />
    </div>
  );
}

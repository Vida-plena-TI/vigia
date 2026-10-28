"use client";

import { BotaoDeCopiar } from "@/components/botao-de-copiar";
import { cn } from "@/lib/utils";

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
   * `tabela`: botão compacto "Copiar" (o cabeçalho da coluna já diz qual campo).
   * `bloco`: celular — título do campo por escrito e botão com rótulo completo
   * e área de toque maior.
   */
  forma: "tabela" | "bloco";
}) {
  const nome = NOME_DO_CAMPO[campo];
  // O banco já grava normalizado; o `trim` é só para nunca colar espaço.
  const texto = valor?.trim() ?? "";
  const faltaPreencher = texto === "";

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1",
        forma === "bloco" && "justify-between",
      )}
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

      <BotaoDeCopiar
        texto={texto}
        rotulo={forma === "bloco" ? `Copiar ${nome.rotulo}` : "Copiar"}
        rotuloAcessivel={`Copiar ${nome.rotulo} de ${pacienteNome}`}
        aviso={`${nome.titulo} de ${pacienteNome} ${nome.copiado}.`}
        disabled={faltaPreencher}
        size={forma === "bloco" ? "lg" : "sm"}
        // 40px de altura no celular: o dedo acerta sem mirar.
        className={forma === "bloco" ? "h-10 min-w-[10.5rem]" : undefined}
      />
    </div>
  );
}

/**
 * As linhas "terapia + tempo por semana" do formulário da aba Cadastro, sem
 * React: como uma linha nasce, como o "Editar" monta as linhas de um plano
 * gravado, o que cada linha envia e a validação do cliente.
 *
 * Mora fora de `tela-de-cadastro.tsx` para o Vitest (ambiente `node`, sem DOM)
 * conseguir afirmar o que o formulário envia em cada caminho.
 */
import type { TerapiaDoPlano } from "@/lib/domain/plano-terapias";
import {
  ERRO_PACIENTE_OBRIGATORIO,
  ERRO_SEM_TERAPIA,
  ERRO_TERAPIA_OBRIGATORIA,
  ERRO_TERAPIA_REPETIDA,
} from "@/lib/domain/plano-terapias-mensagens";
import {
  estadoDoTempoPadrao,
  type EstadoDoTempo,
  minutosDoEstado,
  opcaoDoTempo,
} from "@/lib/domain/tempo-semanal";

/** Uma linha do formulário: os valores como estão nos campos. */
export type LinhaDoFormulario = {
  chave: number;
  terapiaId: string;
  tempo: EstadoDoTempo;
};

/** O erro exibido: a frase e, quando é de uma linha, o índice dela. */
export type Erro = { erro: string; linha?: number };

/** Chave estável de cada linha (só para o React), única na página. */
let ultimaChave = 0;

/**
 * Linha nova — a primeira do formulário e cada "Adicionar terapia": sem
 * terapia e com o tempo padrão (30 minutos) já escolhido.
 */
export function novaLinha(
  terapiaId = "",
  tempo: EstadoDoTempo = estadoDoTempoPadrao(),
): LinhaDoFormulario {
  ultimaChave += 1;
  return { chave: ultimaChave, terapiaId, tempo };
}

/**
 * As linhas do "Editar": uma por terapia do plano gravado, cada uma com o
 * tempo **dela** ({@link opcaoDoTempo}) — o padrão de 30 minutos não entra.
 * Paciente sem plano (legado) abre com uma linha nova.
 */
export function linhasDoPlanoGravado(
  plano: readonly TerapiaDoPlano[],
): LinhaDoFormulario[] {
  if (plano.length === 0) {
    return [novaLinha()];
  }

  return plano.map((terapia) =>
    novaLinha(String(terapia.terapiaId), opcaoDoTempo(terapia.minutosSemanais)),
  );
}

/**
 * A validação do cliente, na ordem dos campos — as mesmas regras de
 * `validarEntrada` em `lib/domain/plano-terapias.ts`, que é a que vale.
 */
export function validarFormulario(
  nome: string,
  linhas: readonly LinhaDoFormulario[],
): Erro | null {
  if (!nome.trim()) {
    return { erro: ERRO_PACIENTE_OBRIGATORIO };
  }

  if (linhas.length === 0) {
    return { erro: ERRO_SEM_TERAPIA };
  }

  const vistas = new Set<string>();

  for (const [indice, linha] of linhas.entries()) {
    if (!linha.terapiaId) {
      return { erro: ERRO_TERAPIA_OBRIGATORIA, linha: indice };
    }

    if (vistas.has(linha.terapiaId)) {
      return { erro: ERRO_TERAPIA_REPETIDA, linha: indice };
    }

    vistas.add(linha.terapiaId);

    const tempo = minutosDoEstado(linha.tempo);

    if (!tempo.ok) {
      return { erro: tempo.erro, linha: indice };
    }
  }

  return null;
}

/**
 * Mensagens do cadastro de encaminhamento.
 *
 * Módulo sem **nenhum** import de banco, pelo mesmo motivo de
 * `requisicoes-mensagens.ts` e `atendimentos-mensagens.ts`: o formulário é
 * Client Component e importa daqui para mostrar exatamente o mesmo texto que o
 * servidor devolveria. Importar `lib/domain/encaminhamentos.ts` do cliente
 * arrastaria o Prisma para o bundle do navegador.
 */

export const ERRO_PACIENTE_OBRIGATORIO = "Informe o nome do paciente.";

export const ERRO_DATA_OBRIGATORIA = "Informe a data do encaminhamento.";

export const ERRO_DATA_INVALIDA =
  "Data do encaminhamento inválida. Use uma data existente no calendário.";

/**
 * A confirmação do cadastro, que **diz qual dos dois caminhos aconteceu**.
 *
 * Um paciente tem no máximo um encaminhamento: cadastrar outro para quem já
 * tinha substitui o anterior (UNIQUE em `encaminhamento.paciente_id`, migration
 * `20260909140000_encaminhamento_unico_por_paciente`). Quem digitou precisa
 * saber que apagou algo — "cadastrado" e "atualizado" são eventos diferentes, e
 * a linha antiga some da lista logo abaixo do formulário.
 *
 * A distinção é a mesma que `scripts/seed-terapias.ts` faz ao relatar o upsert
 * do catálogo ("criada" vs "já existente"), e vem do mesmo lugar: de olhar se a
 * linha existia antes de gravar, não de adivinhar pelo resultado.
 */
export function mensagemDeCadastro(
  pacienteNome: string,
  substituiuAnterior: boolean,
): string {
  return substituiuAnterior
    ? `Encaminhamento atualizado para ${pacienteNome}.`
    : `Encaminhamento cadastrado para ${pacienteNome}.`;
}

// ---------------------------------------------------------------------------
// Remover encaminhamento (30/10/2026)
// ---------------------------------------------------------------------------

export const ERRO_ID_ENCAMINHAMENTO_INVALIDO =
  "Identificador de encaminhamento inválido.";

export const ERRO_ENCAMINHAMENTO_INEXISTENTE =
  "Encaminhamento não encontrado. A lista pode estar desatualizada — recarregue a página.";

/**
 * O aviso do diálogo "Remover encaminhamento". Diz o que **fica** (o paciente
 * e tudo o que é dele) e a consequência que a regra 15 tira disso.
 */
export const AVISO_REMOCAO_DE_ENCAMINHAMENTO =
  "O paciente continua cadastrado, mas não poderá receber nova requisição até ter um novo encaminhamento (regra 15).";

/** Confirmação da remoção. */
export function mensagemDeRemocao(pacienteNome: string): string {
  return `Encaminhamento de ${pacienteNome} removido.`;
}

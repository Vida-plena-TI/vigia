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

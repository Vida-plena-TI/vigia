/**
 * Mensagens de erro do cadastro de encaminhamento.
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

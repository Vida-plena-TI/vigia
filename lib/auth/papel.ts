/**
 * Papel de usuario.
 *
 * Ate 17/09/2026 o sistema nao tinha distincao de perfil: ou o usuario estava
 * autenticado e ativo, ou nao estava. Essa premissa foi revertida — ver
 * "Papeis de usuario" nas decisoes de implementacao do CONTEXT.md.
 *
 * Sem `server-only` de proposito, pelo mesmo motivo de `password.ts` e
 * `session-options.ts`: este modulo e lido pelos scripts de criacao de conta
 * (fora do Next) e pelo `proxy.ts` (fora do contexto de renderizacao).
 *
 * A fonte de verdade do conjunto de valores e o `CHECK (papel IN (...))` da
 * tabela `usuario` (migration `20260917120000_papel_de_usuario`). O Prisma nao
 * expressa CHECK no schema e a coluna e um `String`, entao este tipo e o
 * espelho em TypeScript daquela constraint — os dois tem de mudar juntos.
 */

/** Os papeis aceitos pelo banco, na mesma ordem do CHECK da migration. */
export const PAPEIS = ["admin", "recepcao"] as const;

export type PapelUsuario = (typeof PAPEIS)[number];

/**
 * Estreita uma string vinda do banco ou do cookie para `PapelUsuario`.
 *
 * O banco nao deixa gravar outro valor, mas o cookie e o `String` do Prisma
 * sao, no tipo, texto livre: e aqui que a leitura vira o tipo fechado sem
 * `as`.
 */
export function ehPapelValido(valor: unknown): valor is PapelUsuario {
  return (
    typeof valor === "string" && (PAPEIS as readonly string[]).includes(valor)
  );
}

/**
 * Header interno usado pelo `proxy.ts` para informar as rotas autenticadas qual
 * caminho o usuario pediu. Um layout nao recebe o pathname; sem isso o
 * `next=` do login sairia errado quando o redirect nasce no layout.
 */
export const PATHNAME_HEADER = "x-klini-pathname";

/**
 * Opções padrão de toda `prisma.$transaction` de produção.
 *
 * `maxWait` é o tempo que o Prisma espera para *conseguir* a transação (abrir
 * ou pegar do pool a conexão em que ela vai rodar) — não o tempo de trabalho
 * dentro dela, que é o `timeout`. O padrão do Prisma para `maxWait` é 2000ms, e
 * uma conexão nova contra a pooled do Supabase custa ~2,4s (medido em
 * 02/09/2026, durante a correção da flakiness dos testes de concorrência). Ou
 * seja: o padrão perde para o custo de uma conexão fria por uma margem estreita
 * e constante, e o resultado é `P2028 Unable to start a transaction in the
 * given time` — em produção, sem nenhuma concorrência envolvida, sempre que uma
 * função serverless da Vercel precisar abrir a primeira conexão.
 *
 * 10s dá ~4x de folga sobre os 2,4s medidos. É bem menos que os 30s dos testes
 * de integração, que precisam cobrir 12 arquivos disputando a mesma pooled em
 * paralelo — carga que uma requisição de produção não tem.
 *
 * O `timeout` fica de propósito no padrão do Prisma (5s): o que estava errado
 * era a espera *pela* conexão, não o orçamento de trabalho dentro da transação.
 */
export const OPCOES_DE_TRANSACAO = { maxWait: 10_000 } as const;

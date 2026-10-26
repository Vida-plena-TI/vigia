-- Situacao da requisicao: "solicitada" (enviada ao convenio, em analise) ou
-- "aprovada".
--
-- A situacao e da REQUISICAO (a "pasta" numerada), nao de cada guia: todas as
-- terapias do mesmo numero compartilham a mesma situacao. E um dado gravado,
-- alterado so pelo admin — nao e calculado, e por isso NAO entra na view
-- `requisicao_terapia_saldo` nem no `status_alerta`. Requisicao "solicitada"
-- nao aceita lancamento de atendimento novo (`lancarLoteNaTransacao`).
--
-- Mesmo desenho da migration `20260917120000_papel_de_usuario`.

-- 1. Cria a coluna ja backfillada.
--    O `DEFAULT 'aprovada'` aqui nao e a regra do campo, e o mecanismo do
--    backfill: num `ADD COLUMN ... NOT NULL` o Postgres precisa de um valor
--    para as linhas que ja existem. E 'aprovada' e o valor correto: toda
--    requisicao cadastrada ate aqui ja tem quantidade autorizada e
--    atendimentos lancados contra ela.
ALTER TABLE "requisicao" ADD COLUMN "situacao" TEXT NOT NULL DEFAULT 'aprovada';

-- 2. Derruba o default, feito o backfill.
--    Sem valor implicito: toda insercao informa a situacao explicitamente. Um
--    default permanente faria a requisicao nova nascer em silencio com uma
--    situacao que ninguem escolheu — e poria `schema.prisma` (que declara
--    `situacao String` sem `@default`) em desacordo com o banco.
ALTER TABLE "requisicao" ALTER COLUMN "situacao" DROP DEFAULT;

-- 3. Restringe os valores aceitos.
--    O Prisma nao expressa CHECK no schema; o espelho em TypeScript e
--    `SITUACOES_DE_REQUISICAO` em `lib/domain/situacao-requisicao.ts`, e os
--    dois mudam no mesmo commit.
ALTER TABLE "requisicao"
    ADD CONSTRAINT "requisicao_situacao_valida"
    CHECK ("situacao" IN ('solicitada', 'aprovada'));

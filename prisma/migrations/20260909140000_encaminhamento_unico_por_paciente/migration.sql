-- Um encaminhamento por paciente.
--
-- Regra de negocio nova: cadastrar um encaminhamento para um paciente que ja
-- tem um **substitui** o antigo. Nunca deve sobrar mais de uma linha por
-- `paciente_id`.
--
-- Quem garante isso e a UNIQUE abaixo, nao a aplicacao. A Server Action passou
-- de `INSERT` para `INSERT ... ON CONFLICT ("paciente_id") DO UPDATE`, e esse
-- `ON CONFLICT` **exige** um indice unico nesta coluna para ter arbitro — sem
-- ele o comando nem e aceito pelo Postgres. Ou seja: a constraint nao e um
-- cinto de seguranca redundante, e a peca que faz o upsert existir.

-- 1. Deduplica antes de criar a constraint.
--    Mesmo padrao do dedup de `paciente.nome` em
--    `20260828120100_indices_e_constraints_manuais`: a migration precisa poder
--    rodar sobre uma base que ja tem dados. Aqui a linha mantida e a de
--    `data_encaminhamento` mais recente por paciente (desempate pelo maior
--    `id`, que e a mesma ordem que a listagem ja usa) — e a que a regra nova
--    teria deixado de pe se ela sempre tivesse existido.
--
--    Nao ha nada para repontar antes de apagar: `encaminhamento` e folha, nao
--    e referenciada por FK de ninguem (diferente de `paciente`, que precisou do
--    UPDATE em `requisicao` antes do DELETE).
DELETE FROM "encaminhamento" e
WHERE e."id" <> (
    SELECT e2."id"
    FROM "encaminhamento" e2
    WHERE e2."paciente_id" = e."paciente_id"
    ORDER BY e2."data_encaminhamento" DESC, e2."id" DESC
    LIMIT 1
);

-- 2. O indice comum vira unico.
--    Um indice unico serve tambem como indice de busca por `paciente_id`, entao
--    manter os dois seria pagar duas vezes pela mesma coisa. O nome do novo
--    segue a convencao do Prisma para `@unique` de campo
--    (`<tabela>_<coluna>_key`), para o schema poder declara-lo sem `map` e o
--    `migrate dev` nao ver drift.
DROP INDEX "encaminhamento_paciente_id_idx";

CREATE UNIQUE INDEX "encaminhamento_paciente_id_key" ON "encaminhamento"("paciente_id");

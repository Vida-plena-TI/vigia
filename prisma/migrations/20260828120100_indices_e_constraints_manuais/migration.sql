-- Indices e constraints que o schema Prisma nao expressa nativamente.
-- Mantenha este arquivo junto do schema: nada aqui e regerado por
-- `prisma migrate dev`, so o diff das tabelas e.

-- 1. paciente.nome unico case-insensitive.
--    Elimina duplicados por corrida no get-or-create por nome. O nome e sempre
--    trimado na aplicacao antes de salvar/buscar; aqui garantimos apenas que
--    "Maria Silva" e "maria silva" nao coexistam.
--    Deduplica antes de criar o indice, para o caso de a migration rodar sobre
--    uma base que ja tem dados (repontando as FKs para o registro sobrevivente).
UPDATE "requisicao" r
SET "paciente_id" = d."id_mantido"
FROM (
    SELECT "id" AS "id_removido",
           MIN("id") OVER (PARTITION BY lower("nome")) AS "id_mantido"
    FROM "paciente"
) d
WHERE r."paciente_id" = d."id_removido"
  AND d."id_removido" <> d."id_mantido";

DELETE FROM "paciente" p
WHERE p."id" <> (
    SELECT MIN(p2."id") FROM "paciente" p2 WHERE lower(p2."nome") = lower(p."nome")
);

CREATE UNIQUE INDEX "paciente_nome_lower_key" ON "paciente" (lower("nome"));

-- 2. qtd_autorizada de uma guia precisa ser > 0.
--    Guias com saldo zerado continuam existindo e caem em "Esgotada" pela view;
--    o que esta constraint proibe e autorizar 0 credito na criacao.
ALTER TABLE "requisicao_terapia"
    ADD CONSTRAINT "requisicao_terapia_qtd_autorizada_positiva"
    CHECK ("qtd_autorizada" > 0);

-- 3. creditos_consumidos de um atendimento nao pode ser negativo.
--    Zero e permitido de proposito: a edicao de atendimento aceita 0 creditos
--    (mantido do sistema original), so o lancamento novo exige > 0 — essa parte
--    e validada na aplicacao.
ALTER TABLE "atendimento"
    ADD CONSTRAINT "atendimento_creditos_consumidos_nao_negativo"
    CHECK ("creditos_consumidos" >= 0);

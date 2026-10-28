-- Nome do medico que encaminhou, na autorizacao SulAmerica (so SulAmerica: o
-- encaminhamento do Klini nao tem esta coluna).
--
-- Migration ADITIVA: a coluna nasce NULLABLE e sem default. As autorizacoes
-- cadastradas antes desta data nao tem esse dado, e NULL e "nao informado" —
-- nao ha backfill nem NOT NULL. Quem exige o campo e o formulario de
-- encaminhamento da SulAmerica (`lib/domain/autorizacoes-sulamerica.ts`).
-- Nao reescreve nenhuma linha existente (ADD COLUMN sem default e so catalogo).
--
-- O CHECK e a garantia de quem grava por fora do dominio; o dominio
-- (`lib/domain/nome-medico.ts`) normaliza e recusa antes, com frase em
-- portugues. Os dois mudam no mesmo commit.

ALTER TABLE "autorizacao_sulamerica" ADD COLUMN "nome_medico" TEXT;

-- 3 a 120 caracteres depois do trim. NULL passa (CHECK com NULL e UNKNOWN).
ALTER TABLE "autorizacao_sulamerica"
    ADD CONSTRAINT "autorizacao_sulamerica_nome_medico_tamanho"
    CHECK (char_length(btrim("nome_medico")) BETWEEN 3 AND 120);

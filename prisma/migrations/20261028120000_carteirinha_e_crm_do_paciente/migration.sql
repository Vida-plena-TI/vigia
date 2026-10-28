-- Numero da carteirinha do convenio e CRM do medico que encaminhou, guardados
-- no paciente.
--
-- Migration ADITIVA: as duas colunas nascem NULLABLE e sem default. Pacientes
-- cadastrados antes desta data nao tem esses dados, e nao ha valor verdadeiro
-- para backfillar — NULL e "nao informado", nao um valor inventado. Por isso
-- tambem nao ha NOT NULL: quem exige os dois campos e o cadastro de
-- encaminhamento (`lib/domain/encaminhamentos.ts`), nao a tabela. Nao reescreve
-- nenhuma linha existente.
--
-- Os formatos abaixo tem espelho em TypeScript (`lib/domain/carteirinha-crm.ts`),
-- que normaliza antes de gravar. O CHECK e a garantia de quem grava por fora do
-- dominio; os dois mudam no mesmo commit.

-- 1. As colunas.
ALTER TABLE "paciente" ADD COLUMN "numero_carteirinha" TEXT;
ALTER TABLE "paciente" ADD COLUMN "crm_medico" TEXT;

-- 2. Formato da carteirinha: 5 a 25 letras ou digitos ASCII, nada mais —
--    sem espaco, ponto, hifen ou barra. NULL passa (CHECK com NULL e UNKNOWN,
--    que o Postgres aceita), e e o caso de todo paciente antigo.
ALTER TABLE "paciente"
    ADD CONSTRAINT "paciente_numero_carteirinha_formato"
    CHECK ("numero_carteirinha" ~ '^[A-Za-z0-9]{5,25}$');

-- 3. Formato do CRM: 1 a 10 digitos. A UF nao entra aqui.
ALTER TABLE "paciente"
    ADD CONSTRAINT "paciente_crm_medico_formato"
    CHECK ("crm_medico" ~ '^[0-9]{1,10}$');

-- 4. Uma carteirinha pertence a um paciente so, comparando sem caixa.
--    Mesma ideia do `UNIQUE (lower(nome))`: a comparacao do dominio
--    (`lower(numero_carteirinha) = lower($1)`) usa a mesma expressao do indice,
--    para a checagem previa e a constraint nunca discordarem.
--    Parcial: os NULLs dos pacientes antigos ficam fora do indice. (Um indice
--    unico comum ja deixaria varios NULLs conviverem; o WHERE deixa isso
--    explicito e tira do indice as linhas que nao tem o que comparar.)
--    Expressao + parcial: o Prisma nao expressa nenhum dos dois no schema, e a
--    introspeccao o ignora — como o indice de `paciente.nome`.
CREATE UNIQUE INDEX "paciente_numero_carteirinha_lower_key"
    ON "paciente" (lower("numero_carteirinha"))
    WHERE "numero_carteirinha" IS NOT NULL;

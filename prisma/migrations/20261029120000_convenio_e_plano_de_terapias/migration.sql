-- Convenio do paciente e plano de terapias por semana.
--
-- Migration ADITIVA: uma coluna NULLABLE em `paciente` (sem default — ADD
-- COLUMN sem default e so catalogo, nao reescreve a tabela), o preenchimento
-- dela a partir do que ja existe, e uma tabela nova. O codigo antigo nao le nem
-- grava nada disto e continua funcionando com ela aplicada: a ordem segura de
-- producao e **migration antes do deploy**.
--
-- Os valores do convenio tem espelho em TypeScript (`CONVENIOS`, em
-- `lib/domain/convenio.ts`), e o limite do tempo semanal tambem
-- (`lib/domain/tempo-semanal.ts`). Os dois lados mudam no mesmo commit.

-- 1. O convenio do paciente. NULL e "ainda nao decidido": pacientes sem
--    nenhum cadastro de convenio e, por enquanto, os criados pelos dois
--    cadastros de encaminhamento (que ainda nao gravam a coluna). CHECK com
--    NULL e UNKNOWN, que o Postgres aceita.
ALTER TABLE "paciente" ADD COLUMN "convenio" TEXT;

ALTER TABLE "paciente"
    ADD CONSTRAINT "paciente_convenio_valido"
    CHECK ("convenio" IN ('klini', 'sulamerica'));

-- 2. Preenchimento dos pacientes que ja existem, pelo cadastro que cada um tem:
--    encaminhamento -> 'klini'; autorizacao SulAmerica -> 'sulamerica'.
--    Quem tem OS DOIS fica NULL de proposito: escolher um seria inventar um
--    dado, e a decisao e humana (no banco local, em 29/10/2026, nao havia
--    nenhum; a migration nao supoe isso). Quem nao tem nenhum fica NULL.
--    A condicao `<>` entre os dois EXISTS e o "exatamente um dos dois".
--
--    O bloco entre os marcadores abaixo e lido do disco e executado pelo teste
--    de integracao (`plano-terapias.integration.test.ts`): nao mude os
--    marcadores sem mudar o teste.
-- inicio: preenchimento do convenio
UPDATE "paciente" p
SET "convenio" = CASE
        WHEN EXISTS (SELECT 1 FROM "encaminhamento" e WHERE e."paciente_id" = p."id")
            THEN 'klini'
        ELSE 'sulamerica'
    END
WHERE p."convenio" IS NULL
  AND EXISTS (SELECT 1 FROM "encaminhamento" e WHERE e."paciente_id" = p."id")
      <> EXISTS (SELECT 1 FROM "autorizacao_sulamerica" a WHERE a."paciente_id" = p."id");
-- fim: preenchimento do convenio

-- 3. Plano de terapias: quanto tempo por semana o paciente faz de cada
--    terapia. E so informativo — nenhuma coluna calculada, nenhuma soma, e nada
--    no sistema le o plano para decidir saldo, guia ou atendimento.
--
--    * `minutos_semanais` inteiro: o formulario recebe horas ("2,5") e o
--      dominio converte. Maior que zero, no maximo uma semana (7 * 24 * 60 =
--      10080) e em passos de 15 minutos.
--    * Uma linha por (paciente, terapia): reenviar o cadastro substitui o
--      plano inteiro.
--    * `paciente_id` com ON DELETE CASCADE: o plano nao tem vida sem o
--      paciente, e a exclusao permanente de paciente
--      (`excluirPacienteNaTransacao`) o leva junto sem um DELETE a mais — e o
--      segundo cascade do sistema, depois de atendimento -> guia.
--    * `terapia_id` RESTRICT, como as demais FKs para `terapia`.
--    * O indice unico comeca por `paciente_id` e serve tambem as buscas so por
--      essa coluna; um indice so de `paciente_id` seria pagar duas vezes (mesmo
--      raciocinio de `20261026120000_guia_unica_por_terapia_na_requisicao`).
--      O nome segue a convencao do Prisma, para o schema declara-lo sem `map`.
CREATE TABLE "plano_terapia" (
    "id" SERIAL NOT NULL,
    "paciente_id" INTEGER NOT NULL,
    "terapia_id" INTEGER NOT NULL,
    "minutos_semanais" INTEGER NOT NULL,

    CONSTRAINT "plano_terapia_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "plano_terapia_minutos_semanais_validos" CHECK (
        "minutos_semanais" > 0
        AND "minutos_semanais" <= 10080
        AND "minutos_semanais" % 15 = 0
    )
);

CREATE UNIQUE INDEX "plano_terapia_paciente_id_terapia_id_key" ON "plano_terapia"("paciente_id", "terapia_id");

ALTER TABLE "plano_terapia" ADD CONSTRAINT "plano_terapia_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "paciente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "plano_terapia" ADD CONSTRAINT "plano_terapia_terapia_id_fkey" FOREIGN KEY ("terapia_id") REFERENCES "terapia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

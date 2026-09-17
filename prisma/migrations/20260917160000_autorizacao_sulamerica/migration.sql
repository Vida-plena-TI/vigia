-- Vencimento em meses de calendario; a aplicacao nunca grava a coluna gerada.
CREATE TABLE "autorizacao_sulamerica" (
  "id" SERIAL NOT NULL,
  "paciente_id" INTEGER NOT NULL,
  "data_inicio" DATE NOT NULL,
  "prazo_meses" INTEGER NOT NULL,
  "data_vencimento" DATE GENERATED ALWAYS AS
    (("data_inicio" + ("prazo_meses" * INTERVAL '1 month'))::date) STORED,
  CONSTRAINT "autorizacao_sulamerica_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "autorizacao_sulamerica_prazo_meses_check" CHECK ("prazo_meses" IN (3, 6, 12)),
  CONSTRAINT "autorizacao_sulamerica_paciente_id_fkey" FOREIGN KEY ("paciente_id")
    REFERENCES "paciente"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "autorizacao_sulamerica_paciente_id_key"
  ON "autorizacao_sulamerica"("paciente_id");

CREATE VIEW "autorizacao_sulamerica_status" AS
SELECT a."id", a."paciente_id", a."data_inicio", a."prazo_meses", a."data_vencimento",
  CASE
    WHEN date_trunc('month', a."data_vencimento") < date_trunc('month', CURRENT_DATE)
      THEN 'Vencido'
    WHEN date_trunc('month', a."data_vencimento") = date_trunc('month', CURRENT_DATE)
      THEN 'Vence este mês'
    WHEN date_trunc('month', a."data_vencimento") = date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
      THEN 'A vencer'
    ELSE NULL
  END AS "status_autorizacao"
FROM "autorizacao_sulamerica" a;

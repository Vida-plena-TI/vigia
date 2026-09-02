-- View unica de saldo por guia. Toda leitura de saldo/alerta passa por aqui;
-- a formula NAO deve ser replicada em TypeScript.
--
--   qtd_utilizada       = soma dos creditos_consumidos dos atendimentos da guia
--   saldo_restante      = qtd_autorizada - qtd_utilizada
--   creditos_por_sessao = qtd_autorizada / 4 (0 quando qtd_autorizada e 0/nulo)
--   status_alerta       = Esgotada | Renovar | Regular
--
-- A ordem dos ramos do CASE importa: "Esgotada" tem precedencia sobre
-- "Renovar", e "Renovar" sobre "Regular".

CREATE VIEW "requisicao_terapia_saldo" AS
SELECT
    rt."id",
    rt."requisicao_id",
    rt."terapia_id",
    rt."qtd_autorizada",
    rt."validade",
    COALESCE(a."qtd_utilizada", 0)::int AS "qtd_utilizada",
    (COALESCE(rt."qtd_autorizada", 0) - COALESCE(a."qtd_utilizada", 0))::int AS "saldo_restante",
    CASE
        WHEN COALESCE(rt."qtd_autorizada", 0) = 0 THEN 0::numeric
        ELSE rt."qtd_autorizada"::numeric / 4
    END AS "creditos_por_sessao",
    CASE
        WHEN COALESCE(rt."qtd_autorizada", 0) = 0
          OR (COALESCE(rt."qtd_autorizada", 0) - COALESCE(a."qtd_utilizada", 0)) <= 0
            THEN 'Esgotada'
        WHEN (COALESCE(rt."qtd_autorizada", 0) - COALESCE(a."qtd_utilizada", 0))::numeric
                 <= rt."qtd_autorizada"::numeric / 4
          OR (rt."validade" IS NOT NULL AND rt."validade" <= CURRENT_DATE + INTERVAL '7 days')
            THEN 'Renovar'
        ELSE 'Regular'
    END AS "status_alerta"
FROM "requisicao_terapia" rt
LEFT JOIN (
    SELECT "requisicao_terapia_id", SUM("creditos_consumidos")::int AS "qtd_utilizada"
    FROM "atendimento"
    GROUP BY "requisicao_terapia_id"
) a ON a."requisicao_terapia_id" = rt."id";

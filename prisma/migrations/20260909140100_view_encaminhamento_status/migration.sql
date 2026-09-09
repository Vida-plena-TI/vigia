-- View unica do status de vencimento de um encaminhamento.
--
-- Mesmo papel que `requisicao_terapia_saldo` cumpre para a guia: a
-- classificacao mora aqui e **nao** e replicada em TypeScript. A diferenca
-- entre as duas nao e de estilo, e de unidade de medida:
--
--   * o alerta de validade da guia conta **dias** (`validade <= CURRENT_DATE +
--     7 days`);
--   * o status do encaminhamento compara **meses de calendario**. Um
--     encaminhamento que vence dia 01 e outro que vence dia 31 do mesmo mes
--     dizem a mesma coisa para quem opera a clinica ("vence este mes"), embora
--     estejam a 30 dias de distancia um do outro.
--
-- Dai o `date_trunc('month', ...)` dos dois lados da comparacao: ele joga
-- qualquer data para o dia 1 do seu mes, e a comparacao passa a ser entre meses
-- inteiros. Comparar `data_vencimento` com `CURRENT_DATE` dia a dia daria outra
-- resposta em quase todo dia do mes, que e exatamente o que esta view existe
-- para evitar.
--
-- Os quatro casos (o quarto e a ausencia de status):
--
--   mes de data_vencimento < mes atual      -> 'Vencido'
--   mes de data_vencimento = mes atual      -> 'Vence este mes'
--   mes de data_vencimento = mes atual + 1  -> 'A vencer'
--   dois ou mais meses a frente             -> NULL (nenhuma marcacao)
--
-- NULL e um valor deliberado, nao um descuido: a tela mostra celula neutra, sem
-- selo nenhum, para um encaminhamento que ainda esta longe de vencer. Um quarto
-- rotulo ("Em dia") gastaria atencao com a linha que nao precisa de nenhuma.
--
-- `data_vencimento` e ela propria uma coluna gerada (180 dias corridos, ver
-- `20260909130000_encaminhamento`). Esta view classifica o que aquela coluna
-- produziu — nenhuma das duas regras existe em codigo de aplicacao.
--
-- Os rotulos saem prontos daqui, como 'Regular'/'Renovar'/'Esgotada' saem da
-- view de saldo: a listagem le o campo e pinta o selo, sem traduzir nada.

CREATE VIEW "encaminhamento_status" AS
SELECT
    e."id",
    e."paciente_id",
    e."data_encaminhamento",
    e."data_vencimento",
    CASE
        WHEN date_trunc('month', e."data_vencimento")
                 < date_trunc('month', CURRENT_DATE)
            THEN 'Vencido'
        WHEN date_trunc('month', e."data_vencimento")
                 = date_trunc('month', CURRENT_DATE)
            THEN 'Vence este mês'
        WHEN date_trunc('month', e."data_vencimento")
                 = date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
            THEN 'A vencer'
        ELSE NULL
    END AS "status_encaminhamento"
FROM "encaminhamento" e;

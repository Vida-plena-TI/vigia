-- Uma guia por terapia dentro da mesma requisicao.
--
-- Regra de negocio nova (reverte a decisao de 14/09/2026 que permitia segunda
-- guia da mesma terapia na mesma requisicao): submeter em "Nova requisicao" uma
-- terapia que a requisicao ja tem **atualiza** `qtd_autorizada` e `validade` da
-- guia existente, em vez de inserir outra linha. Nunca deve sobrar mais de uma
-- linha por `(requisicao_id, terapia_id)`.
--
-- A aplicacao ja decide isso olhando antes de gravar; a UNIQUE abaixo e o que
-- garante a regra quando a aplicacao nao e o caminho (INSERT direto, corrida
-- entre dois envios simultaneos).

-- 1. Recusa explicita se ja houver duplicata.
--    Diferente do dedup de `encaminhamento` em
--    `20260909140000_encaminhamento_unico_por_paciente`, aqui NAO ha merge
--    automatico: cada guia pode ter atendimentos vinculados (FK com ON DELETE
--    CASCADE), e apagar ou juntar guias muda saldo e historico. Se esta
--    migration parar aqui, as duplicatas precisam ser resolvidas a mao antes —
--    a consulta que as lista vai na mensagem.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "requisicao_terapia"
        GROUP BY "requisicao_id", "terapia_id"
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION
            'requisicao_terapia tem guias duplicadas por (requisicao_id, terapia_id). Resolva a mao antes de aplicar esta migration: SELECT requisicao_id, terapia_id, count(*) FROM requisicao_terapia GROUP BY requisicao_id, terapia_id HAVING count(*) > 1;';
    END IF;
END
$$;

-- 2. O indice comum de `requisicao_id` vira o unico composto.
--    O indice unico comeca por `requisicao_id`, entao serve tambem as buscas
--    so por essa coluna — manter os dois seria pagar duas vezes pela mesma
--    coisa (mesmo raciocinio da migration de `encaminhamento`). O nome segue a
--    convencao do Prisma para `@@unique` (`<tabela>_<colunas>_key`), para o
--    schema poder declara-lo sem `map` e o `migrate dev` nao ver drift.
DROP INDEX "requisicao_terapia_requisicao_id_idx";

CREATE UNIQUE INDEX "requisicao_terapia_requisicao_id_terapia_id_key" ON "requisicao_terapia"("requisicao_id", "terapia_id");

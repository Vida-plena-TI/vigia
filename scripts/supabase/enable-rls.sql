-- Configuracao especifica do Supabase — NAO faz parte do historico de migrations
-- do Prisma. Rode este arquivo manualmente uma unica vez contra o banco do
-- Supabase (SQL Editor ou psql), fora do fluxo de `npm run db:migrate:deploy`.
--
-- RLS fica ativo nas tabelas de dominio como rede de seguranca para qualquer
-- conexao futura que nao use um role com BYPASSRLS. O role `vigia_app` do
-- Supabase foi criado manualmente com BYPASSRLS e com os grants de leitura e
-- escrita necessarios, e por isso continua enxergando e gravando os dados da
-- aplicacao mesmo sem policies.

ALTER TABLE "paciente" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "usuario" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "terapia" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "requisicao" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "requisicao_terapia" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "atendimento" ENABLE ROW LEVEL SECURITY;

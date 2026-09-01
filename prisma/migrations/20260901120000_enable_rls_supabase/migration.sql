-- RLS fica ativo nas tabelas de dominio como rede de seguranca para qualquer
-- conexao futura que nao use um role com BYPASSRLS. O role `vigia_app` do
-- Supabase foi criado manualmente com BYPASSRLS e, por isso, continua
-- enxergando e gravando os dados da aplicacao mesmo sem policies.

ALTER TABLE "paciente" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "usuario" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "terapia" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "requisicao" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "requisicao_terapia" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "atendimento" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_app') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public TO vigia_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "paciente", "usuario", "terapia", "requisicao", "requisicao_terapia", "atendimento" TO vigia_app';
    EXECUTE 'GRANT SELECT ON TABLE "requisicao_terapia_saldo" TO vigia_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO vigia_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vigia_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO vigia_app';
  END IF;
END $$;

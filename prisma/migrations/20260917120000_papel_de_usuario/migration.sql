-- Papel de usuario.
--
-- Esta migration REVERTE uma premissa que valia desde o inicio do projeto:
-- "nao ha distincao de perfil/papel de usuario, so autenticado+ativo". A
-- partir daqui todo usuario tem um papel, e ele e obrigatorio.
--
-- Fase A de um plano de quatro fases (papeis -> rotas por convenio -> controle
-- de acesso -> SulAmerica). Esta migration acrescenta **apenas o dado**:
-- nenhuma rota e nenhuma permissao dependem de `papel` ainda.

-- 1. Cria a coluna ja backfillada.
--    O `DEFAULT 'admin'` aqui nao e a regra do campo, e o mecanismo do
--    backfill: num `ADD COLUMN ... NOT NULL` o Postgres precisa de um valor
--    para as linhas que ja existem. E 'admin' e o valor correto, nao um
--    chute de conveniencia — ate esta data o sistema so tinha o usuario
--    administrativo unico criado por `scripts/create-admin.ts`, entao todo
--    usuario que existe neste banco E admin.
ALTER TABLE "usuario" ADD COLUMN "papel" TEXT NOT NULL DEFAULT 'admin';

-- 2. Derruba o default, feito o backfill.
--    Decisao registrada: a coluna fica NOT NULL **sem** valor implicito. Um
--    default permanente faria qualquer INSERT que esquecesse o papel nascer
--    admin em silencio — o oposto do que este campo existe para garantir.
--    Sem default, o Prisma passa a exigir `papel` em todo `create` e o erro
--    aparece na compilacao, nao em producao com privilegio a mais.
--
--    Isto tambem e o que mantem `schema.prisma` e banco em acordo: o model
--    `Usuario` declara `papel String` sem `@default`, e se a coluna guardasse
--    um default o proximo `migrate dev` veria drift e proporia derruba-lo.
ALTER TABLE "usuario" ALTER COLUMN "papel" DROP DEFAULT;

-- 3. Restringe os valores aceitos.
--    Mesmo padrao dos CHECKs de `20260828120100_indices_e_constraints_manuais`
--    (`qtd_autorizada > 0`, `creditos_consumidos >= 0`): a regra mora no banco,
--    nao na aplicacao. O Prisma nao expressa CHECK no `schema.prisma`, entao o
--    espelho em TypeScript e `PAPEIS` / `PapelUsuario` em `lib/auth/papel.ts` —
--    acrescentar um papel novo e mudar os dois no mesmo commit.
ALTER TABLE "usuario"
    ADD CONSTRAINT "usuario_papel_valido"
    CHECK ("papel" IN ('admin', 'recepcao'));

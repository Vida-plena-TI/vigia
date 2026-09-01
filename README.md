This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Migrations

O banco é acessado por conexões separadas, apontando para o mesmo projeto Supabase:

| Variável | Usuário | Para quê |
| --- | --- | --- |
| `DATABASE_URL` | `vigia_app.[project-ref]` | runtime da aplicação e Prisma Client, via Supavisor pooled/6543 |
| `DIRECT_DATABASE_URL` | `vigia_app.[project-ref]` | conexão direta/session-mode em 5432 para ferramentas que não devem usar pooler de transação |
| `DATABASE_SUPERUSER_URL` | `postgres.[project-ref]` | apenas migrations no terminal local, via `scripts/run-with-superuser.mjs` |

Em Prisma ORM 7, `url`, `directUrl` e `shadowDatabaseUrl` não ficam mais no
`schema.prisma`; o schema mantém só `provider = "postgresql"` e a CLI lê
`prisma7.config.ts`. A aplicação também não usa o engine binário tradicional em runtime:
`lib/db/index.ts`, `prisma/seed.ts` e `scripts/create-admin.ts` instanciam
`PrismaClient` com `@prisma/adapter-pg`, que é o caminho exigido pelo Prisma 7 para SQL.

O `DATABASE_URL` de produção deve ter este formato pooled:

```text
postgresql://vigia_app.[project-ref]:[senha]@aws-0-[regiao].pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
```

`DIRECT_DATABASE_URL` usa a mesma credencial na porta `5432`, sem
`pgbouncer=true`.

O motivo da separação: se a aplicação for comprometida, a credencial que ela carrega não
consegue executar `CREATE`, `ALTER` ou `DROP`. Migrations são DDL, então devem rodar pelo
wrapper, que aponta a CLI do Prisma para `DATABASE_SUPERUSER_URL` **apenas no processo
filho**, sem alterar o `.env` em disco.

### Desenvolvimento

```bash
npm run db:migrate:dev      # em vez de `npx prisma migrate dev`
npm run db:seed             # dados de exemplo (DML puro, usa o role restrito)
```

### Produção

Rode `npm run db:migrate:deploy` no terminal local, com `.env` contendo
`DATABASE_SUPERUSER_URL`, antes de promover uma versão que dependa de migrations novas.
Não coloque `DATABASE_SUPERUSER_URL` na Vercel.

Na Vercel, mantenha o Build Command padrão (`npm run build`). O `postinstall` roda
`prisma generate`, então o client é gerado durante a instalação.

### Conferir estado

```bash
npm run db:migrate:status   # usa DATABASE_URL mesmo: só lê o histórico de migrations,
                            # e o role restrito tem SELECT em _prisma_migrations
```

### Migrations com SQL manual

Nem tudo que o banco precisa é expressável no `schema.prisma`. Estas migrations são
escritas à mão e não devem ser regeneradas:

- `20260828120100_indices_e_constraints_manuais` — índice `UNIQUE (lower(nome))` em
  `paciente` e os `CHECK` de `qtd_autorizada > 0` / `creditos_consumidos >= 0`.
- `20260828120200_view_requisicao_terapia_saldo` — a view `requisicao_terapia_saldo`, a
  única fonte de `saldo_restante` e `status_alerta`.

O Prisma ignora esses objetos ao diffar o schema, então `migrate dev` não tenta desfazê-los.

### Shadow database

O `migrate dev` precisa de shadow database para detectar drift. Em Supabase, o
`shadowDatabaseUrl` não deve apontar para `DATABASE_SUPERUSER_URL`, porque essa URL é o
banco principal e o Prisma recusa usar o próprio banco da aplicação como shadow. Antes de
usar migrations neste projeto foi confirmado que o role `postgres` tem `CREATEDB`, então o
Prisma cria um shadow temporário automaticamente quando necessário.

## Deploy

Variáveis que vão no painel da Vercel:

| Variável | Uso |
| --- | --- |
| `DATABASE_URL` | pooled Supabase/6543, com `pgbouncer=true&connection_limit=1` |
| `DIRECT_DATABASE_URL` | mesma credencial em 5432, sem `pgbouncer=true` |
| `SESSION_SECRET` | segredo de sessão com pelo menos 32 caracteres |
| `RESEND_API_KEY` | envio do relatório semanal |
| `REPORT_EMAIL_TO` | destinatário(s) do relatório |
| `REPORT_EMAIL_FROM` | remetente verificado no Resend |
| `CRON_SECRET` | bearer token do Vercel Cron |

Variáveis que ficam só no terminal local:

| Variável | Uso |
| --- | --- |
| `DATABASE_SUPERUSER_URL` | migrations locais com o role `postgres` |
| `ADMIN_USERNAME` | criação/atualização do usuário administrativo |
| `ADMIN_PASSWORD` | senha inicial/reset do usuário administrativo |

## Autenticação

Sessão em cookie assinado (iron-session), sem estado no servidor. Não há perfis: ou o
usuário está autenticado e ativo, ou não está.

```bash
# cria/atualiza o usuário administrativo (redefine a senha e reativa a conta)
ADMIN_USERNAME=admin ADMIN_PASSWORD=uma-senha-boa npm run create-admin
```

`SESSION_SECRET` (mínimo 32 caracteres) é obrigatória — sem ela a aplicação falha ao ler a
sessão. `SESSION_TTL_HOURS` é opcional e vale 8 por padrão. O cookie só é `secure` quando
`NODE_ENV=production`, para não quebrar o dev em `http://localhost`.

### Onde a autenticação é verificada

| Camada | Arquivo | O que faz |
| --- | --- | --- |
| Triagem | `proxy.ts` | Abre o cookie assinado. Sem sessão válida → `/login?next=<path>`. Não consulta o banco. |
| Decisão | `lib/auth/current-user.ts` | `requireUsuario()` confirma no banco que o usuário existe e está ativo. Chamado pelo layout de `app/(app)/`. |

A dobra é proposital: o `proxy` é barato e roda antes da renderização, mas *não* é a
autorização — uma Server Action é alcançável por POST direto, sem passar pela UI. Toda
Server Action que lê ou grava dados deve chamar `requireUsuario()`.

Quando a sessão aponta para um usuário que foi apagado ou desativado, `requireUsuario`
redireciona para `GET /api/auth/logout`, que apaga o cookie e devolve ao login — um Server
Component não pode escrever cookies, então a limpeza precisa passar por um route handler.

O parâmetro `next` só é aceito se começar com `/` e não com `//` (nem `/\`), para que o
login não vire um redirecionador para domínios externos.

## Relatório Semanal

O relatório semanal roda em `GET /api/cron/relatorio-semanal`, monta a lista a partir da
mesma query do dashboard (`requisicao_terapia_saldo`) e só envia e-mail quando há pelo
menos um paciente com guia `Renovar` ou `Esgotada`.

Na Vercel, configure `CRON_SECRET` nas Environment Variables. O Vercel Cron deve chamar a
rota com `Authorization: Bearer $CRON_SECRET`; chamadas sem esse header são rejeitadas.

Também são necessárias as variáveis do Resend: `RESEND_API_KEY`, `REPORT_EMAIL_TO` e
`REPORT_EMAIL_FROM`.

## Saldo e status das guias

Os quatro campos calculados de uma guia — `qtd_utilizada`, `saldo_restante`,
`creditos_por_sessao` e `status_alerta` — vêm da view SQL `requisicao_terapia_saldo`,
criada na migration `20260828120200_view_requisicao_terapia_saldo`. **Ela é a fonte de
verdade**: nenhuma tela, Server Action ou route handler deve recalcular saldo em
TypeScript.

`lib/domain/saldo.ts` é um espelho dessas fórmulas em TypeScript, usado **só em teste**.
Ele existe para dois propósitos:

1. servir de especificação executável das regras (precedência `Esgotada > Renovar >
   Regular`, limiar de 25%, janela de 7 dias de validade), com os casos de borda cobertos
   em `lib/domain/saldo.test.ts`;
2. ser comparado com o resultado real da view em `lib/domain/saldo.integration.test.ts`,
   para que uma mudança em só um dos dois lados quebre o build em vez de passar em
   silêncio.

## Testes

```bash
npm test          # roda tudo uma vez
npm run test:watch
```

Runner: [Vitest](https://vitest.dev) (`vitest.config.mts`), ambiente `node`, com o alias
`@/` apontando para a raiz igual ao `tsconfig.json`.

O teste de integração de saldo precisa de `DATABASE_URL` apontando para um Postgres com as
migrations aplicadas. Sem essa variável ele se **auto-pula** em vez de falhar, para o
`npm test` continuar útil em CI sem banco. Quando roda, ele cria as guias de teste dentro
de uma transação que sempre sofre rollback — o banco de desenvolvimento não fica com lixo,
e os dados do seed não são tocados. A data de referência das bordas de validade é o
`CURRENT_DATE` do próprio banco, não o relógio do Node, para o resultado não depender do
fuso da máquina.

## Deploy on Vercel

Use a Vercel como runtime Node.js do Next.js. A preparação do banco fica fora do build:
rode as migrations localmente com `npm run db:migrate:deploy`, confira RLS e só então
promova o deploy com as variáveis da seção `Deploy`.

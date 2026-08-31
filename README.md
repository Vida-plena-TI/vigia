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

O banco é acessado por **dois usuários diferentes**, apontando para o mesmo banco:

| Variável | Usuário | Para quê |
| --- | --- | --- |
| `DATABASE_URL` | role restrito (só DML) | runtime da aplicação e Prisma Client |
| `DATABASE_SUPERUSER_URL` | usuário com DDL | apenas migrations, via `scripts/run-with-superuser.mjs` |

O motivo da separação: se a aplicação for comprometida, a credencial que ela carrega não
consegue executar `CREATE`, `ALTER` ou `DROP`. O custo é que a CLI do Prisma lê a *mesma*
variável `DATABASE_URL` para decidir onde aplicar as migrations — e migrations são DDL.
Rodar `npx prisma migrate dev` direto falha com erro de permissão.

Por isso os comandos de migration passam por um wrapper que sobrescreve `DATABASE_URL`
com `DATABASE_SUPERUSER_URL` **apenas no processo filho**, sem alterar o `.env` em disco.

### Desenvolvimento

```bash
npm run db:migrate:dev      # em vez de `npx prisma migrate dev`
npm run db:seed             # dados de exemplo (DML puro, usa o role restrito)
```

### Produção

`npm run db:migrate:deploy` faz parte do processo de deploy e deve rodar **antes** de a
nova versão começar a servir tráfego. O ambiente de deploy precisa ter as duas variáveis
configuradas — `DATABASE_SUPERUSER_URL` como secret, nunca como variável pública.

Na Vercel isso entra no Build Command (a ser configurado no Prompt 10):

```bash
npm run db:migrate:deploy && npm run build
```

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

O `migrate dev` cria um banco temporário para detectar drift. Como ele roda pelo wrapper,
já se conecta com privilégio suficiente para criar e derrubar esse banco sozinho — não é
preciso configurar nada.

Só defina `SHADOW_DATABASE_URL` se o usuário de migration não puder criar bancos
(`CREATEDB`). Nesse caso aponte para um banco **dedicado e vazio**: com shadow explícito o
Prisma apaga o schema desse banco a cada execução.

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

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

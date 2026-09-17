# VIGIA — Contexto do domínio

> Nota de nomenclatura: o sistema auditado originalmente (relatório de auditoria que deu
> origem a este documento) se chamava "klini". O produto novo, construído do zero em
> Next.js/Postgres, se chama **VIGIA**. Onde este documento ou o código ainda mencionar
> "klini", trate como o nome antigo/legado — o nome exibido para o usuário final
> (título da página, texto do header, e-mails) deve ser **VIGIA**.

Sistema de controle de autorizações de terapia de uma clínica.

> **Premissa revertida em 17/09/2026.** Desde o início do projeto este documento afirmava
> que *"não há distinção de perfil/papel de usuário: existe apenas 'usuário autenticado e
> ativo' ou 'não autenticado'"*. **Isso deixou de ser verdade.** Todo usuário agora tem um
> **papel** (`admin` ou `recepcao`), gravado na coluna `usuario.papel`. Se você encontrar
> em algum lugar do código, de um comentário ou de uma sessão anterior a afirmação de que
> não há perfis, ela está desatualizada — o texto certo é este.
>
> A reversão começou na **Fase A** de um plano de quatro fases (papéis → rotas por
> convênio → controle de acesso → SulAmérica). Ver "Plano de papéis e convênios" no fim de
> "Progresso": **as Fases A, B e C estão implementadas**. Desde a Fase C (17/09/2026) o
> papel **barra**: a recepção alcança só o painel e as duas telas de atendimento, e a raiz
> "/" mostra a escolha de convênio para o admin. As regras estão na regra de negócio 17 e
> em "Controle de acesso por papel" nas decisões de implementação. Se você encontrar em
> algum lugar a afirmação de que o papel ainda não é checado, ela é de antes da Fase C.

## Stack

- Next.js 14+ (App Router) + TypeScript
- Postgres local em desenvolvimento (migração futura para Docker é possível sem
  retrabalho — não há dependência de nada específico da instalação local)
- Prisma ORM
- iron-session para sessão em cookie assinado (cookie `klini_session` — considerar
  renomear para `vigia_session` em algum momento, não é urgente)
- bcryptjs para hash de senha (12 rounds)
- Tailwind CSS + shadcn/ui
- Resend para o relatório semanal por e-mail
- Deploy: Vercel, com Vercel Cron para o relatório semanal

## Entidades

- **paciente**: id, nome (texto, indexado). Get-or-create por nome, comparação
  case-insensitive, nome sempre trimado antes de salvar/buscar. **Único case-insensitive**
  no banco via índice `UNIQUE (lower(nome))`.
- **usuario**: id, username (único, comparação **case-sensitive** — diferente de
  paciente.nome), password_hash (bcrypt), ativo (bool, default true), **papel** (texto,
  `NOT NULL`, `CHECK (papel IN ('admin', 'recepcao'))`, **sem default**). O `papel` entrou
  em 17/09/2026 e reverteu a premissa de que não havia perfis — ver a nota no topo deste
  documento e "Papéis de usuário" nas decisões de implementação. As contas que já existiam
  foram backfilladas como `admin` pela migration `20260917120000_papel_de_usuario`.
- **terapia**: id, nome (único), codigo_tiss (texto).
- **requisicao**: id, numero_requisicao (texto), paciente_id (FK). Único por
  `(paciente_id, numero_requisicao)` — não único globalmente.
- **requisicao_terapia** ("guia"): id, qtd_autorizada (int, CHECK > 0), validade (date,
  opcional), requisicao_id (FK), terapia_id (FK).
- **atendimento**: id, data_atendimento (date), creditos_consumidos (int, default 1,
  CHECK >= 0), observacao (texto, opcional), requisicao_terapia_id (FK,
  **ON DELETE CASCADE**).
- **encaminhamento**: id, paciente_id (FK, `RESTRICT` como as demais, **`UNIQUE`**),
  data_encaminhamento (date, NOT NULL), data_vencimento (date, **coluna gerada pelo
  Postgres** — ver "Vencimento de encaminhamento" abaixo). Um encaminhamento sempre
  pertence a um paciente já existente ou recém-criado pelo mesmo get-or-create por nome
  das requisições. **Um paciente tem no máximo um encaminhamento**: cadastrar outro
  substitui o anterior (regra 13). O status de vencimento não é coluna — vem da view
  `encaminhamento_status`.

Demais FKs (ex: requisicao → paciente) ficam no padrão `RESTRICT`. Só o caminho
atendimento → requisicao_terapia tem cascade — decisão já implementada e confirmada por
teste manual (exclusão de guia com atendimentos: cascade ok; exclusão de requisição com
guias vinculadas: falha, como esperado).

A exclusão completa de um paciente (regra 16) percorre essa cadeia `RESTRICT` à mão, de
baixo para cima, numa transação — e deixa os atendimentos para o único cascade que
existe. Ver `excluirPacienteNaTransacao` em `lib/domain/pacientes.ts`.

## Campos calculados (guia) — vêm de uma view SQL, não de fórmula em TypeScript

View: `requisicao_terapia_saldo`. Ordem de precedência dos status: **Esgotada > Renovar >
Regular**.

- `qtd_utilizada` = soma de `creditos_consumidos` de todos os atendimentos da guia.
- `saldo_restante` = `qtd_autorizada - qtd_utilizada`.
- `creditos_por_sessao` = `qtd_autorizada / 4`, calculado como `numeric` (para `10/4` dar
  `2.5`, não `2` truncado por divisão inteira). 0 se `qtd_autorizada` for vazio/0.
- `status_alerta`:
  - `"Esgotada"` se `qtd_autorizada` vazio/0 OU `saldo_restante <= 0`.
  - `"Renovar"` se `saldo_restante <= qtd_autorizada / 4` OU validade a <= 7 dias.
  - senão `"Regular"`.

As mesmas fórmulas existem em TypeScript (`lib/domain/saldo.ts`) só para uso em testes
que comparam o resultado da view com o cálculo em código — nunca como fonte de verdade em
produção.

## Campo calculado (encaminhamento) — vem de uma coluna gerada, não de fórmula em TypeScript

`encaminhamento.data_vencimento` é uma coluna `GENERATED ALWAYS ... STORED`:

```sql
"data_vencimento" DATE GENERATED ALWAYS AS
    (("data_encaminhamento" + INTERVAL '180 days')::date) STORED
```

Mesma filosofia da view `requisicao_terapia_saldo`: cálculo derivado mora numa única
fonte de verdade no banco, não replicado em código de aplicação. Aqui a garantia é ainda
mais forte que a da view — o `GENERATED ALWAYS` faz o Postgres **recusar** qualquer
INSERT/UPDATE que tente gravar valor nessa coluna, então uma tentativa futura de calcular
o vencimento em TypeScript falha alto em vez de produzir uma linha errada em silêncio.
Há teste de integração afirmando exatamente isso.

Diferente do saldo, **não existe espelho em TypeScript nem para teste**: as datas
esperadas dos testes são literais conferidas à mão, para o teste não repetir a fórmula
que ele deveria estar verificando.

## Status de encaminhamento — vem de uma view, e compara MESES, não dias

View: `encaminhamento_status` (migration `20260909140100_view_encaminhamento_status`).
Ela expõe as colunas da tabela mais `status_encaminhamento`, e é dela que a listagem lê —
como o painel lê `requisicao_terapia_saldo` em vez de `requisicao_terapia`.

A comparação é entre o **mês de calendário** de `data_vencimento` e o mês atual, via
`date_trunc('month', ...)` dos dois lados — **não** pelo número de dias restantes. Essa é
a diferença de unidade em relação ao alerta de validade da guia, que conta dias
(`validade <= CURRENT_DATE + 7 days`): aqui um vencimento no dia 01 e outro no dia 31 do
mesmo mês dizem a mesma coisa para quem opera a clínica, embora estejam a 30 dias um do
outro. Os limiares exatos:

| mês de `data_vencimento` vs. mês atual | `status_encaminhamento` |
| --- | --- |
| anterior ao mês atual | `"Vencido"` |
| igual ao mês atual | `"Vence este mês"` |
| mês seguinte ao atual | `"A vencer"` |
| dois ou mais meses à frente | `NULL` — **nenhuma marcação** |

`NULL` é um dos quatro casos, não ausência de dado: a linha fica com a célula neutra, sem
selo nenhum. Um quarto rótulo ("Em dia") gastaria atenção com exatamente a linha que não
pede nenhuma.

O "mês atual" é o do `CURRENT_DATE` do banco, o mesmo relógio da view de saldo — o do Node
(UTC na Vercel) discordaria dele à noite no horário de Brasília, e na virada do mês essa
diferença trocaria o status de todas as linhas de uma vez.

Como no vencimento, **não existe espelho em TypeScript nem para teste**. O que existe em
TypeScript é `contarPorStatusDeEncaminhamento`, que só **conta** o que a view classificou
(o mesmo papel de `contarPorStatus` no painel). As fronteiras de mês são cobertas por
teste de integração, com os alvos calculados pelo banco a partir do `CURRENT_DATE`: último
dia do mês anterior (`Vencido`), primeiro **e** último dia do mês atual (os dois
`"Vence este mês"` — é o par que uma comparação por dias erraria), primeiro dia do mês
seguinte (`A vencer`) e primeiro dia de dois meses à frente (`NULL`). Datas fixas fariam o
teste passar hoje e mentir no mês que vem.

## Regras de negócio obrigatórias

1. Login exige `usuario.ativo = true` e senha bcrypt válida. Usuário inexistente, inativo
   ou senha errada → **mesma mensagem genérica** ("Usuario ou senha invalidos."), sem
   revelar qual dos três motivos foi. Nenhuma sessão é criada, nenhum redirect ocorre.
   Verificação de senha usa tempo constante mesmo quando o usuário não existe
   (`fakeVerifyPassword`), para não vazar por timing quais usernames existem.
2. Parâmetro `next` do login só é aceito se começar com `/` e não com `//` nem `/\`
   (evita redirect externo e o bypass equivalente com barra invertida).
3. Cookie de sessão: `httpOnly`, `sameSite=lax`, `secure=true` apenas quando
   `NODE_ENV=production`; TTL configurável via `SESSION_TTL_HOURS`, padrão 8 horas.
   `SESSION_SECRET` é obrigatório e precisa ter pelo menos 32 caracteres.
4. Proteção de rotas em **duas camadas**: `proxy.ts` (checagem otimista, só lê o cookie
   assinado, sem bater no banco — redireciona para `/login?next=<path>` se não houver
   sessão) e `requireUsuario()` (confirma no banco que o usuário ainda existe e está
   ativo — usado no layout protegido e deve ser chamado também por qualquer Server Action
   nova, já que uma Server Action é alcançável por POST direto sem passar pelo proxy).
   Sessão órfã (usuário desativado/apagado com sessão ainda aberta) é detectada por essa
   segunda camada e limpa o cookie.
   **A regra 17 (acesso por papel) repete essas mesmas duas camadas**, uma altura acima: o
   proxy desvia pelo papel do cookie, a página e a Server Action reconfirmam pelo papel do
   banco.
   **Exceção: rotas sob `/api/cron/`.** Elas autenticam a si mesmas por Bearer token
   (`CRON_SECRET`) e são chamadas servidor-a-servidor pelo Vercel Cron, que nunca tem
   cookie de sessão. O `proxy.ts` as dispensa da triagem; a proteção continua sendo a
   checagem do segredo dentro do route handler. Ver "Cron interceptado pelo proxy" nas
   decisões de implementação.
5. Criar requisição: get-or-create do paciente + criar `requisicao` + criar N linhas de
   `requisicao_terapia`, tudo em **uma transação atômica**.
   **Uma requisição é uma pasta numerada, não um evento.** Terapias entram nela ao longo
   do tempo, e não só no minuto em que ela nasce. Por isso o cadastro tem dois desfechos,
   decididos pela existência de uma linha em `requisicao` para
   `(paciente_id, numero_requisicao)`:
   - **número inédito para aquele paciente** — cria a `requisicao` e pendura as N linhas
     de `requisicao_terapia` nela (o caminho de sempre);
   - **número que aquele paciente já tem** — **não** cria segunda `requisicao`; insere as
     N linhas de `requisicao_terapia` sob o `requisicao_id` que já existe.
   Nenhuma linha é descartada por "essa terapia já está na requisição": a mesma
   `terapia_id` sob a mesma `requisicao_id` é legítima e comum — é a segunda autorização
   da mesma terapia, com outra quantidade e outra validade. Cada linha é uma autorização,
   não um vínculo. A `validade` continua sendo de cada `requisicao_terapia`, nunca da
   requisição: uma terapia acrescentada hoje a uma pasta antiga carrega a validade dela
   própria, sem tocar nas que já estavam lá.
6. Só terapias com `saldo_restante > 0` aparecem na tela de lançar atendimento.
7. Lançamento de atendimento em lote:
   - pelo menos 1 terapia selecionada;
   - não pode repetir o mesmo `requisicao_terapia_id` no mesmo lote;
   - `creditos_consumidos` deve ser inteiro **> 0**;
   - falha se a guia não existe;
   - falha se o saldo já está esgotado ou se os créditos pedidos excedem o saldo
     disponível;
   - usa `SELECT ... FOR UPDATE` (transação) travando as guias envolvidas em ordem
     determinística por id, para evitar deadlock e corrida de saldo.
8. Edição de atendimento: permite `creditos_consumidos = 0`, rejeita negativo. Recalcula a
   soma dos **outros** atendimentos da mesma guia e rejeita se o total após a edição
   exceder `qtd_autorizada`. (Intencionalmente mais permissiva que a regra de lançamento.)
9. ~~Exclusão de guia: bloqueada no **backend** quando o status é `"Regular"`.~~
   **Revertida em 15/09/2026, por decisão explícita do usuário.** Qualquer guia pode ser
   excluída, em qualquer status. A restrição não era pedido original: nasceu como decisão
   de implementação no Prompt 4, espelhando o sistema legado (que escondia o botão), e
   virou fricção no uso real — cadastro errado e terapia duplicada por engano precisam
   ser apagados, e nenhum dos dois muda de status por isso. O backend não guarda mais
   nenhum limite de status, e a UI mostra "Excluir guia" em toda guia, como já fazia com
   "Histórico".
   O que **continua** de pé: o `SELECT ... FOR UPDATE` que trava a guia durante a
   exclusão, o cascade dos atendimentos filhos (regra 10) e o diálogo de confirmação
   antes de excluir — que passou a ser o único freio.
10. Exclusão de guia apaga os atendimentos filhos via `ON DELETE CASCADE` no banco.
11. Relatório semanal: agrupa guias por paciente, mantém só pacientes com pelo menos uma
    guia `Renovar` ou `Esgotada`. Se a lista final estiver vazia, não envia e-mail.
12. Encaminhamento vence **180 dias corridos** depois de `data_encaminhamento`. Regra fixa
    e confirmada. **Não são seis meses de calendário** — ver "Os 180 dias não são seis
    meses" nas decisões de implementação, que registra por que os dois divergem da
    planilha de referência do usuário. O cálculo é do banco (coluna gerada), nunca de
    TypeScript.
13. **Um encaminhamento por paciente.** Cadastrar um encaminhamento para um paciente que
    já tem um **substitui** o antigo — nunca sobra mais de uma linha por `paciente_id`.
    Quem garante é a `UNIQUE (paciente_id)`; a Server Action faz
    `INSERT ... ON CONFLICT ("paciente_id") DO UPDATE SET data_encaminhamento = ...`, e o
    Postgres recalcula `data_vencimento` sozinho (coluna gerada). A confirmação distingue
    os dois casos: "Encaminhamento atualizado para X" quando substituiu, "Encaminhamento
    cadastrado para X" quando não havia nada — mesma distinção que
    `scripts/seed-terapias.ts` faz no upsert do catálogo, e pelo mesmo caminho (olhar se a
    linha existia **antes** de gravar).
14. Status de encaminhamento é comparação de **mês**, não de dias — ver "Status de
    encaminhamento" acima para os quatro limiares exatos.
15. **Encaminhamento é pré-requisito de requisição.** Não se cria requisição para um
    paciente que não tenha uma linha em `encaminhamento`. A checagem mora dentro da mesma
    transação que faz o get-or-create do paciente (`lib/domain/requisicoes.ts`), depois de
    resolver o `paciente_id` e antes de qualquer escrita de requisição; a recusa é lançada,
    não devolvida, para o rollback levar junto um paciente que o get-or-create acabou de
    criar. Vale igual para paciente já existente e para nome digitado pela primeira vez.
    A exigência é de **existência, não de validade**: qualquer encaminhamento serve,
    inclusive um já vencido — a consulta é à tabela `encaminhamento`, não à view
    `encaminhamento_status`. Consequência silenciosa desta regra: `pacienteCriado` no
    resultado de `criarRequisicao` **nunca é `true` num sucesso**, porque um paciente
    recém-criado ali não teria como já ter encaminhamento. O campo continua existindo e
    sendo relatado com honestidade; se um dia a regra mudar, ele volta a variar.
16. **Exclusão de paciente é permanente, completa e sem desfazer.** A partir da listagem
    de encaminhamentos, excluir apaga o paciente inteiro — encaminhamento, requisições,
    guias e atendimentos — em `DELETE` real, numa única transação. Não há soft-delete,
    arquivamento nem lixeira. Ver "Exclusão permanente de paciente" nas decisões de
    implementação, inclusive a ressalva sobre guarda de prontuário.

17. **Acesso por papel (17/09/2026, Fase C).** `admin` tem acesso irrestrito — a tudo que
    existe hoje e a toda rota nova, sem precisar ser cadastrada em lugar nenhum.
    `recepcao` alcança **somente** `/klini/dashboard`, `/klini/atendimentos/novo`,
    `/klini/atendimentos/hoje` e a raiz `/`; qualquer outro caminho a manda para
    `/klini/dashboard`. Na prática, o que fica de fora é "Nova requisição" e
    "Encaminhamentos" (inclusive a exclusão permanente de paciente, que só existe lá). A
    raiz `/` ramifica: admin vê a tela de escolha de convênio, recepção é redirecionada
    direto para `/klini/dashboard`, sem ver escolha nenhuma. Quem não tem permissão vai
    para `/klini/dashboard`, **não** para `/login`: a pessoa está autenticada: falta
    permissão, não identificação — e mandá-la ao login faria o `next=` trazê-la de volta
    para a mesma parede. A regra é decidida num lugar só, `podeAcessarRota` em
    `lib/auth/acesso.ts`, e é escrita como **lista do que a recepção pode**, não do que
    ela não pode: rota nova nasce fechada para ela (a `/sulamerica` da Fase D inclusive) e
    aberta para o admin. Ver "Controle de acesso por papel" nas decisões de implementação
    para as camadas.

## Decisões assumidas (perguntas em aberto no relatório de auditoria original)

- `paciente.nome`: único case-insensitive no banco.
- `numero_requisicao`: único por paciente, não globalmente. Repetir o número de um
  paciente **não é erro**: acrescenta terapias à requisição que já existe (regra 5). O
  índice único continua no banco — ver "Número repetido acrescenta em vez de recusar" nas
  decisões de implementação.
- `qtd_autorizada`: deve ser > 0 na criação da guia.
- ~~Exclusão de guia `"Regular"` bloqueada no backend.~~ Revertida — ver regra 9.
- Edição de atendimento para 0 créditos continua permitida.

## Decisões tomadas durante a implementação (não estavam no relatório original)

- **Status HTTP do login**: a regra "falha de login retorna 400" do sistema legado (que
  usava FastAPI + Jinja2 renderizando HTML direto) **não se aplica literalmente** aqui.
  Server Actions do Next.js sempre respondem 200 (payload RSC) por natureza da tecnologia.
  O requisito funcional real — erro exibido, nenhuma sessão criada, nenhum redirect —
  está preservado; o código de status HTTP em si não é consumido por nada no sistema
  (nenhum client-side código depende de checar `response.status === 400`). Divergência
  intencional, não é bug.
- **Separação de conexões de banco de dados**: `DATABASE_URL` aponta para o role
  `vigia_app.[project-ref]` na conexão pooled do Supavisor (`6543`,
  `pgbouncer=true&connection_limit=1`) e é o que o Prisma Client usa em runtime.
  `DIRECT_DATABASE_URL` usa a mesma credencial `vigia_app.[project-ref]` na porta `5432`,
  sem `pgbouncer=true`, para ferramentas que precisam evitar o pooler de transação.
  `DATABASE_SUPERUSER_URL` aponta para `postgres.[project-ref]` na porta `5432`, usado
  **somente** por migrations no terminal local, nunca importado pelo código da aplicação.
  Em Prisma ORM 7.10, `url`, `directUrl` e `shadowDatabaseUrl` não ficam mais no
  `schema.prisma`: o schema mantém só `provider = "postgresql"` e a CLI lê
  `prisma7.config.ts`. O antigo papel de `directUrl` é coberto no config pela preferência
  por `DIRECT_DATABASE_URL`, e o wrapper `scripts/run-with-superuser.mjs` define
  `PRISMA_MIGRATION_DATABASE_URL=DATABASE_SUPERUSER_URL` apenas no processo filho ao rodar
  `npm run db:migrate:dev` / `npm run db:migrate:deploy`.
- **Shadow database no Prisma 7 + Supabase**: `shadowDatabaseUrl` **não** aponta para
  `DATABASE_SUPERUSER_URL`. Quando o wrapper usa o superusuário como `datasource.url`, essa
  URL é o próprio banco principal, e o Prisma recusa usá-la também como shadow. O role
  `postgres` do Supabase foi verificado em 01/09/2026 com `rolcreatedb = true`; por isso o
  `migrate dev` pode deixar `shadowDatabaseUrl` ausente e o Prisma cria um shadow
  temporário automaticamente quando precisar detectar drift.
- **Prisma 7 usa driver adapter em runtime**: o projeto está em Prisma ORM 7.10.0, e o
  caminho SQL atual exige driver adapter em vez do engine binário tradicional no
  `PrismaClient`. O runtime (`lib/db/index.ts`), o seed (`prisma/seed.ts`) e o script de
  admin (`scripts/create-admin.ts`) instanciam `PrismaClient` com `@prisma/adapter-pg`.
  Isso também é a escolha compatível com Supavisor em modo transação, porque o adapter usa
  o driver `pg` e recebe a connection string pooled do ambiente da aplicação.
- **Runner de teste: Vitest**. Não havia nenhum configurado; o Vitest entra sem
  transpilador extra (lê TypeScript direto) e reaproveita o alias `@/` do `tsconfig` via
  `vitest.config.mts`. O teste de integração de saldo se auto-pula quando `DATABASE_URL`
  não está definida, para `npm test` não exigir banco em CI.
- **Página inicial (`/`)**: faz `redirect("/klini/dashboard")` — não duplica o conteúdo
  do dashboard na rota raiz. O dashboard vive em `app/(app)/klini/dashboard` como rota
  própria.
- **`middleware.ts` → `proxy.ts`**: no Next 16, o arquivo de middleware foi renomeado para
  `proxy.ts`. Isso é só uma mudança de nome de arquivo/convenção da framework, não afeta
  nenhuma regra de negócio.
- **Cron interceptado pelo proxy (bug de produção, corrigido em 09/09/2026)**: o
  `/api/cron/relatorio-semanal` respondia **307 para `/login`** em produção, com e sem o
  header `Authorization: Bearer $CRON_SECRET` — confirmado nos logs reais da Vercel. O
  relatório semanal nunca foi enviado.
  **Causa raiz:** o `matcher` do `proxy.ts` cobria tudo menos assets, e a lista de
  dispensa era só `ROTAS_PUBLICAS = ["/login", "/api/auth"]`. `/api/cron/...` não estava
  em nenhuma das duas, então o proxy rodava primeiro, não achava cookie de sessão e
  redirecionava. A checagem de `CRON_SECRET` do `route.ts` **nunca chegava a executar** —
  ela estava correta o tempo todo, só era inalcançável. O sintoma enganava: como o proxy
  decide por caminho e não por header, a resposta era idêntica com e sem o Bearer, o que
  parecia "segredo errado" e não "rota interceptada".
  **Correção:** `ROTAS_COM_AUTENTICACAO_PROPRIA = ["/api/cron"]` no `proxy.ts`, dispensada
  da triagem de sessão, mais a exclusão de `api/cron` no `matcher` para o proxy nem ser
  invocado. A redundância é deliberada e está afirmada em teste, para as duas não saírem
  de sincronia. A checagem de `CRON_SECRET` no `route.ts` foi mantida intacta — ela é, e
  segue sendo, a única proteção real da rota. O conceito é distinto de "rota pública":
  `/api/cron/` não é aberta, só não usa cookie.
  **Por que os testes do Prompt 9 não pegaram:** `lib/relatorio/route.test.ts` importa
  `GET` e chama a função direto, sem passar pelo `proxy.ts`. Testava a camada certa de
  forma isolada e continua verde — o bug morava na composição das duas camadas, que não
  tinha teste nenhum. O `lib/auth/proxy.test.ts` novo cobre essa junção: monta a
  requisição sem cookie e com Bearer correto, afirma que o proxy **não** redireciona e só
  então chama o `GET`, verificando que a rota é alcançada (200) e que o Bearer errado
  ainda dá 401. O arquivo tem também um teste de controle (`/klini/dashboard` sem sessão →
  redirect), sem o qual uma asserção quebrada de "não redirecionou" passaria vazia.
  **Achado no caminho:** o primeiro `matcher` da correção excluía `api/cron` sem delimitar
  o fim do segmento, e com isso tirava `/api/cronicas` da triagem de sessão também — uma
  rota futura com esse prefixo ficaria sem proxy. O teste de caminho parecido pegou antes
  do commit; o padrão final é `api/cron(?:/|$)`.
- **Dashboard (`/klini/dashboard`)**: leitura em Server Component, mutação em Server
  Action. A consulta vive em `lib/domain/guias.ts` e usa `$queryRaw` com join da
  view `requisicao_terapia_saldo` com `requisicao`, `paciente` e `terapia` — o
  Prisma não mapeia views no `schema.prisma`, e escrever o join à mão é mais
  honesto do que fingir que a view é um model. Ordenação por `lower(paciente.nome)`,
  com desempate por id do paciente, nome da terapia e id da guia para o resultado
  ser estável. (O `lower()` não é redundante com a collation atual, que já ordena
  ignorando caixa — ele é o que preserva a ordem num banco criado com collation
  `C`, que ordenaria por byte. Ver "Collation do banco" abaixo.)
- **Colunas `DATE` viajam como texto**: `validade` e `data_atendimento` saem do
  banco como `"AAAA-MM-DD"` (via `::text` ou fatiando o ISO) e só são formatadas
  para `DD/MM/AAAA` na tela. Virar `Date` faria o dia exibido depender do fuso de
  quem renderiza — servidor e navegador podem discordar e a data aparecer um dia
  deslocada.
- **Exclusão de guia trava a linha antes de apagar**: `excluirGuiaNaTransacao`
  faz `SELECT ... FOR UPDATE` em `requisicao_terapia` antes do DELETE, e é ele
  quem descobre que a guia não existe. O travamento nasceu para proteger uma
  checagem de status que não existe mais (regra 9, revertida), mas continua
  valendo por si: sem ele, um lançamento de atendimento concorrente (regra 7, que
  trava as mesmas linhas) poderia gravar numa guia que este DELETE está prestes a
  apagar. Por isso a função recebe o cliente de transação em vez de abrir a
  própria — é o que deixa o teste de integração rodar com rollback.
- **Filtro de busca do dashboard é client-side**: a lista inteira já vem
  renderizada do servidor e é filtrada em memória (sem acento e sem caixa), sem
  ida-e-volta por tecla. Se o volume crescer a ponto de pesar, o filtro vira
  `searchParams` + `WHERE` no banco. O resumo por status no topo continua contando
  o sistema inteiro, não o filtro — é painel de alerta da clínica, não deveria
  mudar quando alguém digita um nome.
- **Histórico da guia em `Dialog` do shadcn/ui**, não em rota separada: os
  atendimentos são carregados sob demanda ao abrir (Server Function
  `listarHistoricoDaGuia`), uma vez por guia. Mandá-los todos no HTML inicial
  encheria a página de dados que quase nunca são abertos.
- **Texto novo já usa acentuação e o nome VIGIA**. Os arquivos anteriores estão
  sem acento (decisão antiga, provavelmente de encoding); código novo não repete
  isso, porque a acentuação errada chega ao usuário final. A troca do texto
  antigo entra junto com o Prompt 10.
- **Scripts de conta idempotentes**: `scripts/create-admin.ts` (via `npm run create-admin`,
  lendo `ADMIN_USERNAME`/`ADMIN_PASSWORD`) e `scripts/create-recepcao.ts` (via
  `npm run create-recepcao`, lendo `RECEPCAO_USERNAME`/`RECEPCAO_PASSWORD`) redefinem a
  senha, reativam a conta e regravam o papel se o usuário já existir, em vez de falhar por
  duplicata. É o jeito recomendado de resetar uma senha — evitar apagar/recriar via SQL
  manual. Os dois são casca em volta de `criarOuAtualizarUsuario`
  (`lib/auth/criar-usuario.ts`): a regra de idempotência existe uma vez só, para os dois
  não divergirem em silêncio quando um deles for mexido. Cada um lê **seu próprio par** de
  variáveis; ver "Papéis de usuário" abaixo para o porquê.
- **Papéis de usuário (17/09/2026, Fase A, branch `feat/papel-de-usuario`) — reversão de
  premissa.** Até esta data o documento afirmava que o sistema não tinha distinção de
  perfil, só "autenticado e ativo". Passou a ter: `usuario.papel`, texto `NOT NULL` com
  `CHECK (papel IN ('admin', 'recepcao'))`.
  **Sem default na coluna, de propósito.** A migration `20260917120000_papel_de_usuario`
  cria a coluna com `DEFAULT 'admin'` *só para backfillar* as linhas existentes (o
  Postgres precisa de um valor num `ADD COLUMN NOT NULL`) e derruba o default no comando
  seguinte, no mesmo arquivo. `'admin'` não é chute de conveniência: até aquela data o
  sistema só tinha contas criadas por `create-admin.ts`, então todo usuário que já existia
  **era** admin — confirmado no banco local, onde as duas linhas pré-existentes (`admin` e
  `codex_teste`) saíram da migration como `admin`. Derrubar o default é o que faz um
  `INSERT` que esqueça o papel **falhar** em vez de nascer admin em silêncio, e é também o
  que mantém `schema.prisma` e banco em acordo — o model declara `papel String` sem
  `@default`, e um default guardado na coluna faria o próximo `migrate dev` ver drift.
  **O conjunto de valores mora no banco.** O Prisma não expressa `CHECK` no schema (mesma
  situação do `UNIQUE (lower(nome))` de `paciente`), então `papel` é `String` no model e o
  espelho em TypeScript é `PAPEIS` / `PapelUsuario` em `lib/auth/papel.ts`. Acrescentar um
  papel é mudar os dois no mesmo commit; há teste de integração que manda um papel
  inválido e exige a recusa do Postgres.
  **Variáveis de ambiente separadas** (`ADMIN_*` e `RECEPCAO_*`, sem reaproveitar um par
  para os dois scripts): como o papel é reescrito também no caminho de atualização, um
  único par deixaria ambíguo qual conta o comando está mexendo — e uma confusão dessas
  rebaixaria o admin a recepção sem avisar.
  **O que esta fase NÃO faz:** nenhuma rota, nenhum layout e nenhuma Server Action
  ramifica por papel. `requireUsuario()` devolve o papel e não barra ninguém com ele.
- **Papel na sessão, mas a sessão não é a autoridade.** O cookie assinado passou a levar
  `papel` e `username` junto de `usuarioId` (`SessionData` em `lib/auth/session-options.ts`,
  gravados no `login` de `lib/auth/actions.ts`). O motivo é o `proxy.ts`, que roda antes de
  tudo e **não consulta o banco**: com o papel no cookie ele decide o desvio da Fase C sem
  uma ida ao Postgres por requisição. Desde a Fase C é `proxy.ts` quem lê esse campo — e
  ninguém mais.
  Isso **não** move a autoridade para o cookie. `requireUsuario()` continua sendo a fonte
  de verdade (regra 4), pela mesma razão de sempre — ela enxerga conta desativada ou papel
  trocado *depois* que o cookie foi selado, e o cookie não. Os campos do cookie são cópias
  que envelhecem: mudar o papel de alguém no banco só aparece lá no próximo login. Por
  isso `getUsuarioAtual()` lê `papel` do banco, e não da sessão.
  Detalhe de tipos nas duas pontas: como `papel` é `String` no Prisma, a leitura passa por
  `ehPapelValido` antes de virar `PapelUsuario`. No login, papel irreconhecível grava a
  sessão **sem** papel (ausente é o caso restritivo, não o permissivo); em
  `getUsuarioAtual`, ele derruba a autenticação — inalcançável enquanto o CHECK estiver de
  pé, e é o que impede uma conta circular com um papel que o TypeScript acha que conhece.
  **Nota para quem vier depois:** `username` **não** estava na sessão antes desta mudança
  (só `usuarioId`). Ele entrou junto, pela mesma razão que o papel.
- **Controle de acesso por papel (17/09/2026, Fase C, branch
  `feat/controle-de-acesso-por-papel`) — duas camadas, e a lista é do lado do permitido.**
  A regra de quem alcança o quê (regra 17) mora em **um** módulo, `lib/auth/acesso.ts`, e
  as três coisas que dependem dela leem de lá: o `proxy.ts`, as páginas/Server Actions
  restritas e o menu. O módulo não importa `server-only`, pelo mesmo motivo de `papel.ts`:
  o proxy roda fora do contexto de renderização.
  **Camada 1, otimista — `proxy.ts`.** Abre o cookie assinado, lê o `papel` que o login
  selou ali e, se aquele papel não alcança o caminho pedido, redireciona para
  `/klini/dashboard`. Não consulta o banco; é a mesma divisão de trabalho da regra 4, uma
  altura acima: rápido, sem I/O, e **nunca** a palavra final.
  **Camada 2, autoritativa — a página e a Server Action.** `requireAcessoARota()`
  (páginas) e `autorizarRota()` (actions), em `lib/auth/current-user.ts`, decidem pelo
  papel **lido do banco** naquela requisição. É a camada que enxerga um papel trocado
  depois que o cookie foi selado, e é a única que existe no caminho de um POST montado à
  mão — uma Server Action é alcançável sem navegar, e proteção que mora na navegação se
  contorna com um `curl`. A página redireciona; a action **devolve erro**
  (`MENSAGEM_SEM_PERMISSAO`) em vez de lançar, porque o chamador legítimo desse caminho é
  uma aba velha, aberta antes de o papel mudar, e o que ela precisa é de uma frase no
  formulário.
  **Camada 3, o menu — conveniência, não proteção.** `itensDeNavegacaoPara`
  (`app/(app)/itens-de-navegacao.ts`) filtra os itens da faixa pelo mesmo
  `podeAcessarRota`, e o botão "Nova requisição" do painel some pelo mesmo teste. Esconder
  link não barra ninguém; ele existe para a recepção não ver uma porta que não abre.
  **Allowlist, não lista de proibidas.** `podeAcessarRota` responde `true` para `admin`
  sem olhar caminho, e para `recepcao` só nos prefixos de `ROTAS_DA_RECEPCAO`. A
  alternativa (listar as rotas proibidas) faria toda rota futura nascer **aberta** para a
  recepção — e o esquecimento seria silencioso. Com o allowlist, quem criar `/sulamerica`
  na Fase D precisa decidir explicitamente se a recepção entra.
  **A única decisão permissiva do conjunto, e por quê.** No proxy, cookie **sem** `papel`
  passa. Isso contraria a nota da Fase A ("ausente é o caso restritivo"), e a troca é
  deliberada: cookie sem papel é um cookie selado antes da Fase A, ou seja, de um usuário
  que era necessariamente admin. Fechar ali jogaria todo admin com sessão aberta no
  painel, sem explicação, no deploy — e não compraria segurança nenhuma, porque a camada 2
  recusa de qualquer forma (ela lê o banco, não o cookie). No banco a ausência não existe:
  papel fora de `PAPEIS` derruba a autenticação em `getUsuarioAtual`.
  **A raiz `/` deixou de ser um `redirect` fixo.** `app/(app)/page.tsx` virou tela de
  escolha de convênio para o admin (dois cartões, sem cor — convênio não é status) e
  continua um `redirect` para quem é recepção. O cartão da SulAmérica já aponta para
  `/sulamerica/dashboard`, que **ainda dá 404** até a Fase D: o destino é o definitivo
  desde agora para o link não ter de mudar depois. A marca "VIGIA" do cabeçalho passou a
  levar para `/` em vez de `/klini/dashboard` — é o único caminho de volta para a escolha.
  **O que a Fase C NÃO faz:** nenhuma checagem de papel entrou nas actions do painel e dos
  atendimentos (lançar, editar, excluir atendimento, excluir guia, histórico). São as
  telas que a recepção usa, e elas continuam exigindo só `requireUsuario()`. Consequência
  assumida: a recepção pode excluir uma guia pelo painel, embora não possa criar uma
  requisição. Se isso não for o desejado, é regra nova, não correção de bug.
- **Collation do banco (verificado em 31/08/2026)**: o Postgres de desenvolvimento é
  16.11, `server_encoding = UTF8`, `datcollate = datctype = Portuguese_Brazil.1252`.
  **Não** é a collation `C`. Consequência prática: `lower()` faz case-folding Unicode
  completo (`lower('JOSÉ SILVA') = 'josé silva'`), então o índice
  `UNIQUE (lower(nome))` de `paciente` pega duplicatas acentuadas. Confirmado por teste
  manual com rollback: `'José Silva'` entra; `'JOSÉ SILVA'`, `'josé silva'`,
  `'JoSé SiLvA'` e `'CONCEIÇÃO ÂNGELA'` (contra `'Conceição Ângela'`) são todos
  rejeitados com `23505` em `paciente_nome_lower_key`.
  **Isso depende da instalação, não do schema.** Num Postgres criado com `--locale=C`
  (comum em imagens Docker mínimas), `lower()` só dobra ASCII: `lower('JOSÉ')` viraria
  `'josÉ'` e `'JOSÉ SILVA'` entraria como um segundo paciente. Ver a pendência
  correspondente no fim deste documento.
- **Cadastro de requisição (`/klini/requisicoes/nova`)**: leitura das listas (pacientes,
  terapias) em Server Component; o formulário é Client Component porque a lista de
  terapias cresce e encolhe por estado do React. Decisões do caminho:
  - **Get-or-create do paciente em uma consulta só**: `INSERT ... ON CONFLICT
(lower("nome")) DO NOTHING RETURNING ...` dentro de uma CTE, com `UNION ALL` para o
    `SELECT` do já existente. Um `SELECT` seguido de `INSERT` deixaria aberta a corrida
    entre dois cadastros simultâneos do mesmo nome. A comparação é
    `lower(nome) = lower($1)` — **a mesma expressão do índice**; usar outra regra
    (`ILIKE`, `unaccent`, comparação em TypeScript) faria a busca e a constraint
    discordarem, e o insert estouraria em vez de reaproveitar a linha.
  - **Erro de negócio dentro da transação é `throw`, não `return`**: devolver
    `{ ok: false }` de dentro do callback do `$transaction` faria o Prisma **commitar** o
    que já tinha sido escrito — e o paciente recém-criado ficaria órfão. Por isso
    `criarNaTransacao` lança `ErroDeNegocio` e quem chama converte de volta para
    `{ ok: false }`, já com a transação desfeita.
  - **Número repetido acrescenta em vez de recusar** (14/09/2026). O `SELECT` que roda
    antes do insert continua exatamente onde estava, mas **deixou de ser uma recusa**: ele
    escolhe entre os dois desfechos da regra 5. Achou a requisição daquele paciente com
    aquele número? As linhas de `requisicao_terapia` entram sob o `requisicao_id` dela, e
    `tx.requisicao.create` nem é chamado — não há duplicata a evitar, há um INSERT que não
    acontece. Não achou? Requisição e guias nascem juntas, no mesmo comando aninhado de
    sempre.
    **O índice único `requisicao_paciente_id_numero_requisicao_key` não foi removido nem
    afrouxado**, e nenhuma migration foi escrita: o que mudou foi o comportamento em cima
    dele, de "rejeitar" para "anexar à requisição existente". Ele continua sendo o que
    garante que aquele par nunca vire duas pastas — e continua sendo consultado do jeito
    certo, por `pacienteId` **mais** `numeroRequisicao`, porque o mesmo número na pasta de
    outra pessoa é outra requisição, que não pode receber estas terapias.
    O `P2002` ainda é traduzido, mas agora para outra coisa. Ele só é alcançável numa
    corrida estreita — dois envios do *primeiro* cadastro daquele número chegando juntos,
    os dois vendo o `SELECT` vazio, os dois tentando inserir. A mensagem
    (`erroCorridaNaRequisicao`) pede **reenvio**, não outro número: reenviar agora
    funciona, porque a requisição existe e o envio seguinte cai no ramo que acrescenta.
    A confirmação passou a distinguir os dois desfechos, como o cadastro de encaminhamento
    já fazia entre "cadastrado" e "atualizado": `mensagemDeCriacao` devolve "Requisição
    criada para X" ou "N terapia(s) adicionada(s) à requisição Y de X". Sem essa palavra,
    um número digitado por engano pareceria ter criado uma requisição nova, e o painel
    mostraria as terapias penduradas na pasta errada sem explicação. Quem decide é o
    domínio (`requisicaoCriada` e `terapiasAdicionadas` no resultado); o formulário só
    monta a frase.
  - **A validade já nasce preenchida com hoje + 1 mês de calendário** (15/09/2026). Toda
    linha de terapia do formulário — a primeira, cada uma criada por "Adicionar outra
    terapia" e a que volta depois da limpeza do sucesso — começa com a data que
    `validadePadraoDeGuia` (em `lib/domain/requisicoes.ts`) lê do banco. Vale para os dois
    desfechos da regra 5, porque é o mesmo formulário: criar a requisição nova e
    acrescentar terapias à requisição que o paciente já tem.
    **O motivo é de negócio, não de conveniência de digitação**: uma autorização parada
    perde validade real por volta de um mês, e a guia que nascia sem validade ficava
    `Regular` para sempre — o painel não tinha como cobrá-la. Com o padrão, ela entra
    sozinha em `Renovar` perto de um mês depois de criada, que é quando alguém precisa
    olhar para ela. **A regra de `status_alerta` não mudou nem um caractere**: continua
    sendo da view, continua sendo `validade <= CURRENT_DATE + 7 days`. O que mudou foi só
    o valor que o campo já traz.
    **Um mês de calendário, não 30 dias.** A conta é `CURRENT_DATE + INTERVAL '1 month'`,
    e é o Postgres que grampeia o dia no último do mês de destino quando ele não existe
    lá: 31/01 dá 28/02 (29/02 em ano bissexto), não 03/03. É o mesmo desenho do
    `+ INTERVAL '180 days'` de `encaminhamento.data_vencimento` — muda a unidade, e é a
    unidade que faz a fronteira cair no lugar certo. Os casos de fronteira têm teste de
    integração com alvos literais conferidos à mão, e ali as datas **são** fixas, ao
    contrário do resto daquele arquivo: o que está sob teste é a aritmética de calendário,
    e mirar a partir do `CURRENT_DATE` daria um teste que só exercitaria o caso
    interessante em janeiro.
    **A data vem do `CURRENT_DATE` do banco**, não do relógio do Node nem do navegador,
    pelo mesmo motivo da data padrão de "Lançar atendimento": é o mesmo "hoje" que a view
    usa para decidir `Renovar` por validade, e um servidor em UTC discordaria dele à noite
    no horário de Brasília. A página busca o valor junto das outras duas listas, no mesmo
    `Promise.all`, e passa como prop ao formulário — o cliente não calcula data nenhuma.
    **É valor inicial, não piso nem obrigação**, exatamente como o `4` de "Qtd.
    autorizada": o campo continua editável e continua opcional. Digitar outra data grava a
    data digitada; apagar o campo grava `NULL` e a guia segue sem prazo. Nada é
    recalculado no servidor depois do envio — `criarRequisicao` grava o que veio do
    formulário, e `validadePadraoDeGuia` não é chamada em lugar nenhum do caminho de
    gravação. O parâmetro `referencia` dela existe só para o teste mirar fronteiras de mês
    que o `CURRENT_DATE` ofereceria uma vez por ano; em produção nunca é passado.
  - **Linhas de terapia viajam como campos repetidos** (`terapiaId`, `qtdAutorizada`,
    `validade`, um conjunto por linha renderizada), lidos com `formData.getAll` e
    costurados por índice. Quando os vetores chegam com tamanhos diferentes (só possível
    num POST montado à mão) usa-se o maior, para a linha incompleta cair na validação em
    vez de herdar em silêncio o valor da linha vizinha.
  - **Texto do formulário vira número com regex, não com `Number`**: `Number("")` é `0` e
    `Number("1e3")` é `1000` — converter cru deixaria passar quantidade que o usuário
    nunca digitou.
  - **Campos controlados por estado do React**: o React 19 limpa os campos não
    controlados depois que a action roda, o que apagaria tudo que foi digitado justamente
    quando a action volta com erro e o usuário precisa corrigir uma linha.
  - **`select` de terapia é nativo, não o do shadcn/ui**: o do Radix injeta um `select`
    escondido para participar do formulário, e aqui há um por linha; o campo nativo é o
    que o `getAll` enxerga de forma previsível. As classes visuais são copiadas do
    `Input` para não destoar.
  - **Mensagens de erro em `lib/domain/requisicoes-mensagens.ts`**, um módulo sem nenhum
    import de banco. O formulário (cliente) e a validação (servidor) importam dele para
    mostrarem o mesmo texto; importar `lib/domain/requisicoes.ts` do cliente arrastaria o
    Prisma para o bundle do navegador.
  - **Toast de sucesso viaja pela URL**: o `redirect` da Server Action troca a página
    inteira, então o aviso vai como `?criada=<numero>&paciente=<nome>`; o dashboard
    dispara o toast (`sonner`) e apaga a query com `router.replace`, para o aviso não
    voltar a cada recarga. Não há `revalidatePath`: o dashboard é dinâmico (depende da
    sessão) e o `redirect` já entrega a página recém-renderizada.
  - **`sonner` + `next-themes`**: `npx shadcn add sonner` trouxe `next-themes` junto. O
    projeto não tem alternador de tema, e o componente sobrescreve as cores com as
    variáveis CSS da aplicação (`--popover`, `--border`), então o `theme` do sonner não
    muda o resultado visual. O arquivo foi mantido como o registry gerou, para não
    divergir no próximo `shadcn add`.
- **Lançamento de atendimento (`/klini/atendimentos/novo`)**: leitura da lista de
  pacientes e
  da data de hoje em Server Component; as guias vêm sob demanda (Server Function
  `carregarGuiasDoPaciente`) quando o paciente é escolhido, como o histórico de guia do
  dashboard. Decisões do caminho:
  - **A ordem `FOR UPDATE` -> leitura da view é a regra inteira, não um detalhe.** Em
    READ COMMITTED cada comando tira um snapshot novo: enquanto a transação A não
    commita, o `FOR UPDATE` de B fica bloqueado, e quando B destrava o `SELECT` seguinte
    na view é um comando novo que já enxerga o atendimento de A. Ler o saldo antes de
    travar (ou na mesma consulta) devolveria o saldo velho e as duas transações
    aprovariam o mesmo crédito. O teste de concorrência falha exatamente assim quando as
    duas consultas são invertidas — foi verificado.
  - **O lock é em `requisicao_terapia`, não na view**: `FOR UPDATE` não se aplica a view
    com agregação, e inserir em `atendimento` não toca em `requisicao_terapia`. A linha
    da guia funciona como ponto de encontro combinado: vale porque _todo_ caminho que
    mexe no saldo passa por ela — `excluirGuiaNaTransacao` trava as mesmas linhas pelo
    mesmo motivo.
  - **`ORDER BY "id"` no `FOR UPDATE` é o antideadlock**: no plano do Postgres o nó
    `LockRows` fica acima do `Sort`, então as linhas são travadas na ordem ordenada.
    Dois lotes que compartilham as guias 7 e 9 pedem os locks na mesma sequência e um
    espera o outro, em vez de se travarem em cruz.
  - **Erro de negócio aqui é `return`, não `throw`** (ao contrário de
    `criarRequisicaoNaTransacao`): até o INSERT final nada foi escrito, então não há o
    que desfazer. Só os locks ficam de pé, e eles caem no fim da transação de qualquer
    jeito.
  - **A guia precisa ser do paciente do lote**: checagem que a UI não consegue violar,
    mas um POST montado à mão sim. Sem ela, um lote poderia pendurar atendimentos em
    guias de outro paciente.
  - **Créditos > 0 no lançamento, mas `>= 0` na edição** (regra 8): lançar zero crédito
    não significa nada — é linha marcada por engano. A permissividade da edição é
    intencional e não se aplica aqui.
  - **Data padrão vem do `CURRENT_DATE` do banco**, não do relógio do Node nem do
    navegador. É o mesmo "hoje" que a view usa para decidir `Renovar` por validade; se
    os dois discordassem (servidor em UTC, clínica em horário de Brasília), o
    atendimento lançado à noite cairia no dia seguinte enquanto o alerta de validade
    ainda contaria o dia anterior. Como as outras colunas `DATE`, a data viaja como
    texto `"AAAA-MM-DD"`.
  - **Checkbox + campo de créditos `disabled` mantêm os vetores do `getAll` alinhados**:
    um checkbox não marcado não é enviado, e um campo `disabled` também não. Assim
    `requisicaoTerapiaId` e `creditosConsumidos` chegam com o mesmo tamanho e a mesma
    ordem, e o índice do erro devolvido pelo servidor aponta a linha certa na tela.
  - **Sucesso não navega** (diferente do cadastro de requisição, que redireciona): o
    formulário se limpa ali mesmo e mostra o toast, para lançar o próximo paciente sem
    esperar uma navegação — é o comportamento do sistema Worker atual, melhor que o do
    legado nesse ponto. Como não há `redirect`, o aviso não precisa viajar pela URL: o
    `useActionState` devolve um `sucesso` com um token único, e o formulário guarda o
    último token tratado para não repetir a limpeza no StrictMode nem confundir dois
    lotes de números idênticos.
  - **A data sobrevive à limpeza**; paciente, observação e seleções não. Quem lança o
    dia inteiro de atendimentos não quer redigitar a mesma data a cada paciente.
  - **`refresh()` em vez de `revalidatePath`**: nada é cacheado (a página é dinâmica por
    causa da sessão), mas depois do lançamento um paciente pode ter esgotado a última
    guia e precisa sumir do `select` — o `refresh` redesenha o Server Component sem
    derrubar o estado do formulário.
  - **Mensagens em `lib/domain/atendimentos-mensagens.ts`**, um módulo sem nenhum import
    de banco, pelo mesmo motivo de `requisicoes-mensagens.ts`.
  - **`textarea` e `select` nativos**, com as classes do `Input` copiadas: o projeto não
    tem o `textarea` do shadcn/ui instalado, e o `select` do Radix injeta um campo
    escondido que o `FormData` enxerga de forma menos previsível.
  - **O teste de concorrência commita de verdade e limpa no `afterAll`**: o padrão de
    rollback dos outros testes de integração não serve aqui, já que o ponto é uma
    transação enxergar o _commit_ da outra. A interleaving é forçada com um portão (a
    transação A para com o lock de pé até o teste liberar) e o bloqueio de B é
    confirmado no `pg_stat_activity` — não é um `sleep` esperançoso.
  - **O portão tem de ser aberto num `finally`.** Como o teste commita, a limpeza depende
    do `afterAll`; e se qualquer asserção falhar entre a abertura da transação A e o
    `portao.abrir()`, A fica segurando o lock da guia até o timeout de 30s. O `afterAll`
    então trava nos `DELETE` esperando esse mesmo lock, estoura o próprio timeout e deixa
    paciente/requisição/terapia commitados no banco. O `finally` abre o portão e espera as
    duas transações terminarem (`Promise.allSettled`, porque no caminho de falha elas
    rejeitam e o erro que importa é o da asserção).
  - **`apagarCenario` é tolerante a falha, mas não silenciosa**: cada `DELETE` roda no seu
    próprio `try`, para que um que falhe não impeça os seguintes, e o que não for apagado
    sai num `console.error` com o id da linha. Este teste roda contra o banco de produção;
    lixo esquecido lá só some se alguém enxergar qual é.
  - **O pool é aquecido antes de abrir a transação A** (`aquecerPool`, quatro
    `pg_sleep` em paralelo). A transação B é a função de _produção_, que usa o `maxWait`
    padrão do Prisma (2s) para conseguir a conexão — e abrir uma conexão nova contra o
    Supabase remoto custa ~2,4s, medido. Sem aquecer, B morre com `P2028` **antes** de
    chegar ao `SELECT ... FOR UPDATE`: nenhuma conexão aparece esperando lock e o teste
    acusa "não bloqueou" sem ter chegado a exercitar o lock que ele existe para provar.
  - **Todo `$transaction` dos testes de integração leva `maxWait: 30_000` junto do
    `timeout: 30_000`.** `timeout` é o tempo _dentro_ da transação; `maxWait` é o tempo
    para _consegui-la_, e o padrão de 2s é curto demais quando os 12 arquivos de teste
    rodam em paralelo contra a pooled do Supabase. Sem isso a suíte falha de forma
    intermitente com `P2028 Unable to start a transaction in the given time`, em arquivos
    diferentes a cada rodada — parece flakiness de concorrência e não é.

- **Sistema de design (passagem visual, aplicada a todas as telas do Prompt 2 ao 8)**.
  Vale para as telas novas dos Prompts 8-9 e para qualquer tela futura: seguir o que está
  aqui em vez de redescobrir as escolhas. O sistema inteiro mora em `app/globals.css`
  (tokens + três classes de componente) e em `app/(app)/klini/dashboard/formato.ts` +
  `status-badge.tsx` (apresentação de status).
  - **Princípio que organiza a paleta: cor é informação, nunca decoração.** As únicas
    cores saturadas do sistema são as três de `status_alerta`. Todo o chrome — cabeçalho,
    botões, links, títulos, bordas — vive numa escala grafite/papel. É o que impede o olho
    de se acostumar com cor e deixar de reagir quando ela significa alguma coisa. Um botão
    "Excluir" na tabela é neutro de propósito; o carmim aparece só no botão de confirmação
    dentro do diálogo, onde a ação realmente acontece.
  - **Paleta (6 cores nomeadas)**: Grafite `#16202A` (tinta, faixa do cabeçalho, ação
    primária), Névoa `#ECEFF3` (fundo da página), Papel `#FFFFFF` (superfície de dado),
    Teal `#0E6E7D` (Regular), Âmbar `#8A5300` (Renovar), Carmim `#A8103C` (Esgotada).
    Contraste sobre branco: 6,1:1 / 6,3:1 / 7,4:1; branco sobre carmim 7,4:1 — AA em texto
    normal, não só em texto grande. `--muted-foreground: #55637A` dá 6,1:1 sobre papel e
    5,3:1 sobre névoa; `--input: #7D8B9C` dá 3,5:1 (mínimo de componente de interface),
    para o campo parecer campo antes de receber foco.
  - **Status não depende de cor.** O eixo verde-vermelho puro foi evitado: "Regular" é
    teal, puxado para o lado azul do espectro, onde sobrevive a protanopia e deuteranopia.
    Mas a cor é só um dos cinco canais redundantes — os outros quatro são preenchimento
    (Esgotada é bloco sólido com texto branco, Renovar é fundo tênue com anel, Regular é
    só contorno), ícone com silhueta distinta (`Check` / `TriangleAlert` / `OctagonAlert`),
    peso da fonte (700 no Esgotada, 500 nos outros) e o filete de margem de 3px na linha da
    tabela (`MARCADOR_POR_STATUS`). Em escala de cinza os três continuam inconfundíveis.
    **Ao acrescentar tela nova, usar `StatusBadge` e `MARCADOR_POR_STATUS` — não recriar a
    cor à mão**, senão os cinco canais deixam de andar juntos.
    **Quando o vocabulário não servir**, o que se reaproveita é a *forma*, não as
    palavras: `components/selo-de-status.tsx` guarda a geometria do selo (retângulo de
    canto curto, `text-2xs`, ícone de 12px, gap) e recebe rótulo, cor e ícone de fora, num
    `ApresentacaoDeSelo`. Foi o que a tela de encaminhamentos usou para ter os três
    rótulos dela sem tomar emprestado "Regular/Renovar/Esgotada" — ver "Encaminhamentos"
    nas decisões. Continua valendo: **nenhuma cor saturada nova entra no sistema**; a
    diferença de urgência dentro de uma mesma cor se faz por preenchimento e peso.
  - **O saldo é o número da decisão.** Autorizada e utilizada ficam em `muted-foreground`;
    só `saldo_restante` fica na tinta cheia, e vira carmim em negrito quando `<= 0`, porque
    aí o próprio número já é o alerta.
  - **Tipografia: IBM Plex Sans** (400/500/600/700) em tudo, escolhida por ser desenhada
    para interface técnica densa e ter algarismo tabular real (`tnum`, ligado globalmente
    no `html` — não usar fonte monoespaçada para número). **IBM Plex Serif** (600) em
    exatamente dois lugares: o logotipo "VIGIA" e os três contadores do resumo de status.
    São a face do instrumento — o nome dele e a leitura de ponteiro. Nunca abaixo de
    1,75rem, nunca em texto corrido, nunca em número de tabela.
    Escala (tokens em `@theme inline`): `2xs` 11px, `xs` 12px, `sm` 13px (corpo de tabela
    densa), `base` 16px (texto de leitura e **todo** campo de formulário — abaixo disso o
    iOS dá zoom no foco), `lg` 18px, `xl` 21px (título de formulário), `2xl` 26px (título
    de tela densa), `4xl` 44px (contadores).
    **Antes desta passagem o `@theme inline` tinha `--font-sans: var(--font-sans)`** — uma
    referência circular para uma variável nunca definida em `:root`. A `font-family` ficava
    inválida e o navegador caía no serifado padrão; o Geist carregado no `app/layout.tsx`
    nunca chegou a ser aplicado. Se alguma fonte "vazar" de novo, é aqui que se olha.
  - **Largura diz o que a tela é.** Telas densas (painel, atendimentos de hoje) vão até
    `max-w-[90rem]`, alinhadas à mesma borda esquerda do cabeçalho. Telas de formulário
    (nova requisição, lançar atendimento) usam `max-w-[46rem]` e continuam **alinhadas à
    esquerda**, não centralizadas. A diferença de medida é o que diz, antes de qualquer
    leitura, se a tela é para varrer ou para preencher.
  - **Régua, não cartão.** Dado mora em folha pautada (`.folha` — filete de 1px, raio de
    3px, sem sombra); o painel é um livro-razão único com os pacientes separados por faixa,
    não um cartão por paciente. Formulário é dividido por régua rotulada e numerada
    (`.regua-de-secao`: "1. Paciente e data", "2. Terapias atendidas"), não por pilha de
    `Card`. Elevação e raio maior (8px) ficam reservados para o que flutua de verdade:
    diálogo, toast e a folha do login. **Não criar um `Card` genérico por seção** — foi
    justamente o que esta passagem removeu.
  - **Login é a única tela escura**, com fundo grafite e a folha branca centralizada: dá
    para saber que se está fora do sistema antes de ler qualquer palavra.
  - **Foco de teclado**: os componentes do shadcn trazem o próprio anel; para o resto há um
    `:where(a, button, summary, [tabindex]):focus-visible` em `@layer base` com
    `outline: 2px solid var(--anel-foco)`. `--anel-foco` é grafite por padrão e é
    sobrescrito para branco dentro da faixa escura e da tela de login — um contorno grafite
    sobre fundo grafite seria invisível.
  - **Responsivo até o celular por reestruturação, não por rolagem lateral**: a tabela de
    oito colunas do painel vira lista de blocos abaixo de `md` (`GuiaEmBloco`), e a de
    atendimentos de hoje abaixo de `sm`. A navegação da faixa rola na horizontal.
  - **Branding**: todo texto visível diz **VIGIA** — faixa do cabeçalho, `metadata.title`
    da raiz e do login. Os rótulos de navegação são iguais aos `<h1>` das páginas,
    acentuação incluída ("Nova requisição", "Lançar atendimento"). O `name` do
    `package.json`, o cookie `klini_session` e o header `x-klini-pathname` continuam com o
    nome antigo — nada disso é visível ao usuário, e trocar o cookie derruba as sessões
    abertas.

- **Painel com pacientes recolhidos e botão de copiar** (só camada de apresentação —
  nenhuma Server Action, consulta ou regra de negócio foi tocada; `listarGuiasDoDashboard`
  continua trazendo tudo de uma vez).
  - **O que se perde ao recolher volta pelo cabeçalho.** Cada paciente começa fechado, e a
    linha do cabeçalho carrega o **pior status entre as guias dele** — mesmo `StatusBadge`
    e mesmo `MARCADOR_POR_STATUS` (filete de 3px na margem) das linhas da tabela, sem cor
    nova. Com tudo recolhido ainda dá para varrer a coluna da esquerda e saber onde abrir;
    nenhum "Esgotada" fica escondido dentro de um paciente fechado. A precedência é a mesma
    do CONTEXT.md (Esgotada > Renovar > Regular), em `piorStatus`.
  - **Guias sem sub-agrupamento por requisição.** Dentro do paciente segue a lista única de
    terapias autorizadas, com o número da requisição em coluna própria. Na prática o
    paciente tem uma requisição só; agrupar por número acrescentaria um nível de hierarquia
    que quase sempre teria um filho só.
  - **Padrão de acordeão do WAI-ARIA**: `<h2>` com um `<button>` dentro (o leitor de tela
    continua navegando por cabeçalho), `aria-expanded` no botão e `aria-controls` apontando
    para o painel, que **existe no DOM aberto ou fechado** — só o conteúdo dele é montado
    sob demanda, para não instanciar dezenas de diálogos de histórico e exclusão que
    ninguém abriu. O anel de foco desse botão usa `outline-offset: -3px`: o padrão do
    sistema (`+2px`) fica do lado de fora e seria cortado pelo `overflow-hidden` da folha.
  - **Aberto/fechado é derivado, não sincronizado por efeito.** O estado guarda só os
    pacientes que o usuário abriu ou fechou **na mão** (`manuais`); sem entrada ali vale o
    padrão — recolhido sem busca, **expandido quando há termo de busca**. É isso que faz o
    filtro abrir sozinho o que sobrou no resultado sem `useEffect` nenhum: o padrão muda
    junto com o termo. Consequência intencional: fechar um paciente durante a busca o mantém
    fechado, e um aberto à mão continua aberto depois de limpar a busca — a escolha
    explícita sempre ganha do padrão.
  - **Copiar é um irmão do botão de expandir, não um filho.** `"Nome do paciente - Número
da requisição"` via `navigator.clipboard.writeText`. Aninhar um `<button>` dentro do
    outro é HTML inválido, e mesmo com `stopPropagation` o clique em copiar acabaria
    abrindo o paciente sem querer; por isso o cabeçalho é uma linha com dois controles
    independentes, e o de copiar aparece igual recolhido ou expandido.
  - **O aviso de "copiou" é a troca de silhueta do ícone** (`Copy` -> `Check`, 2s), não uma
    cor: teal, âmbar e carmim são reservados para `status_alerta`, e um check verde gastaria
    uma cor que significa outra coisa na mesma tela. Quem não vê o ícone recebe o aviso por
    uma região `role="status"`. Toast fica só para a falha (área de transferência
    indisponível fora de contexto seguro, ou `writeText` rejeitado) — nada de `alert()`.
  - **Caso defensivo do número da requisição**: o schema permite mais de uma `requisicao`
    por paciente (a unique é `(paciente_id, numero_requisicao)`, não por paciente), e o seed
    de desenvolvimento **já cai nesse caso** — "Ana Beatriz Moraes" tem as requisições 1
    (`2026-0001`) e 142 (`56565`). `numeroDaRequisicaoMaisRecente` escolhe a de **maior
    `requisicao_id`**, para o texto não depender da ordem em que as guias chegaram. É
    salvaguarda: não há nenhuma interface construída em cima disso.
  - **`lib/domain/guias-apresentacao.ts`**: `piorStatus`, `numeroDaRequisicaoMaisRecente` e
    `textoDeCopia` moram em `lib/` e não junto do componente por dois motivos — o painel é
    Client Component e importar `lib/domain/guias.ts` de lá arrastaria o Prisma para o
    bundle do navegador (mesmo motivo dos módulos `*-mensagens.ts`), e o `include` do Vitest
    só enxerga `lib/**` e `prisma/**`. `STATUS_EM_ORDEM_DE_URGENCIA` foi movida para lá e é
    reexportada por `app/(app)/klini/dashboard/formato.ts`: é a mesma precedência do resumo
    do
    topo e do pior status do cabeçalho, e duas cópias acabariam divergindo.
  - **Cobertura**: as três funções puras têm teste unitário
    (`lib/domain/guias-apresentacao.test.ts`, 14 casos, incluindo o de múltiplas
    requisições). O comportamento de interface (recolhido por padrão, clique/Enter/Espaço,
    busca expandindo o resultado, clipboard) foi verificado **no navegador**, não em teste
    de componente: o projeto não tem jsdom nem testing-library, e o `environment` do Vitest
    é `node`. Montar esse aparato só para esta tela não se paga agora — se um dia entrar,
    é aqui que estes casos devem virar teste automatizado.

- **Encaminhamentos (`/klini/encaminhamentos`)**: cadastro e listagem na **mesma** tela,
  sem rota `/novo` e sem diálogo. Decisões do caminho:
  - **Os 180 dias não são seis meses — e a divergência é deliberada.** A planilha de
    referência do usuário usa **seis meses de calendário**; o sistema usa **180 dias
    corridos**, escolha confirmada. Os dois quase nunca coincidem: um encaminhamento de
    `2026-01-01` vence em `2026-06-30` pela regra do sistema e em `2026-07-01` pela regra
    da planilha (o primeiro semestre de um ano não bissexto tem 181 dias). Este parágrafo
    existe para que ninguém "conserte" a migration ao comparar as duas fontes daqui a um
    ano. Se a regra mudar um dia, ela muda **na migration**, não em código de aplicação —
    e o teste que trava a mudança acidental é o que compara, no mesmo `SELECT`, a coluna
    gerada com `+ INTERVAL '6 months'` e afirma que as duas discordam.
  - **O vencimento é coluna gerada, não view.** A view foi a ferramenta certa para o saldo
    porque ele agrega atendimentos de outras tabelas; aqui a derivação é de uma coluna só
    da própria linha, e `GENERATED ALWAYS ... STORED` é a forma mais barata e mais estrita
    de dizer isso. Estrita porque o Postgres passa a **recusar** a escrita: quem um dia
    tentar mandar o vencimento calculado em TypeScript no INSERT recebe erro `428C9`, não
    uma linha errada. O INSERT do domínio nem menciona a coluna; o valor volta pelo
    `RETURNING`.
  - **`date + interval` devolve `timestamp`, não `date`** — daí o `::date` explícito na
    expressão da migration, para ela caber na coluna sem depender de cast de atribuição
    implícito.
  - **O Prisma não tem sintaxe para coluna gerada, e a declaração do schema precisa ser
    exatamente a que a introspecção produz.** A primeira versão declarava
    `dataVencimento DateTime? @db.Date` e nada mais — schema válido, testes verdes, e um
    `prisma migrate dev` futuro gerando `ALTER TABLE "encaminhamento" ALTER COLUMN
"data_vencimento" DROP DEFAULT`, comando que o Postgres **recusa** em coluna gerada (o
    equivalente correto seria `DROP EXPRESSION`). A causa: o Postgres guarda a expressão
    de geração no `pg_attrdef`, o mesmo lugar dos defaults, e a introspecção do Prisma a
    lê como se fosse um `@default`. Sem ele no schema, o diff vê um default sobrando e
    tenta removê-lo. A correção é copiar a forma **normalizada pelo Postgres**:
    `@default(dbgenerated("((data_encaminhamento + '180 days'::interval))::date"))`.
    Isso foi observado, não suposto — `prisma migrate dev --create-only` gerava a migration
    quebrada antes e passou a gerar migration vazia depois. Se a expressão da migration
    mudar, `prisma db pull --print` mostra a forma exata que o schema tem de repetir.
  - **`DateTime?` (opcional) dos dois lados**: a coluna é declarada NULLABLE na migration
    de propósito. Ela nunca é nula na prática, mas declará-la NOT NULL faria o modelo
    Prisma precisar ser obrigatório, e um campo obrigatório entra nos argumentos exigidos
    pelo `create` — pedindo justamente o valor que ninguém pode fornecer.
  - **Get-or-create de paciente subiu para `lib/domain/pacientes.ts`.** Ele morava em
    `requisicoes.ts` enquanto tinha um consumidor só; com o segundo, foi movido em vez de
    copiado — duas cópias divergiriam, e é justamente a expressão de comparação
    (`lower(nome) = lower($1)`, a mesma do índice `UNIQUE (lower(nome))`) que precisa ser
    idêntica em todo lugar. `listarNomesDePacientes` foi junto, pelo mesmo motivo: os dois
    formulários alimentam o mesmo `datalist`. Nenhum comportamento mudou na mudança de
    arquivo, e os testes de integração de requisição continuam verdes por cima dele.
  - **Formulário inline no topo da própria listagem.** Não há
    `/klini/encaminhamentos/novo` nem
    diálogo: o formulário é uma faixa no topo e a lista vem logo abaixo. Ao enviar, a
    Server Action chama `refresh()` — o Server Component da página redesenha e o registro
    novo aparece na lista sem navegação — e o formulário se limpa e devolve o foco ao campo
    de nome. É o mesmo desenho de "Lançar atendimento" (sucesso não navega), pelo mesmo
    motivo: cadastrar vários pacientes em sequência rápida é o uso esperado aqui também.
    O botão de submit usa `useFormStatus` e por isso vive num componente à parte — o hook
    só enxerga o formulário de cima.
  - **A data volta para "hoje", não para vazio.** "Limpar os campos" depois do sucesso
    devolve o formulário ao estado inicial, e o estado inicial da data é o `CURRENT_DATE`
    do banco (não o relógio do navegador, pelo mesmo motivo de "Lançar atendimento"). Um
    campo de data literalmente vazio obrigaria a redigitar o dia inteiro a cada paciente da
    fila, que é o contrário do que a tela existe para fazer. O nome do paciente, esse sim,
    volta vazio.
  - **Ordem da lista: status primeiro, `lower(nome)` dentro dele.** A tela é olhada o dia
    inteiro para responder "de quem eu preciso cuidar agora", e quem responde isso é o
    status, não a ordem alfabética nem a de cadastro. O `ORDER BY` de
    `listarEncaminhamentos` abre com um `CASE` que traduz o rótulo vindo da view em
    prioridade — `Vencido` 1, `Vence este mês` 2, `A vencer` 3, `NULL` (sem marcação) 4,
    a mesma sequência de `STATUS_DE_ENCAMINHAMENTO_EM_ORDEM` com o caso sem rótulo no fim
    — e desempata por `lower(p."nome")`, a mesma expressão do índice
    `UNIQUE (lower(nome))` e a mesma que o painel usa. Não sobra desempate a fazer depois:
    um paciente tem um encaminhamento só e um nome só, então `lower(nome)` já é único
    entre as linhas desta consulta.
    O `CASE` vive **só no `ORDER BY`**: não virou coluna da consulta, nem coluna da view,
    nem campo de `EncaminhamentoNaLista`. A view continua sendo quem diz *qual* é o
    status; isto aqui só diz em que ordem os quatro casos aparecem — é ordenação de
    leitura, e duplicar a classificação para poder ordená-la seria exatamente a segunda
    fonte de verdade que a view existe para não ter. Pelo mesmo motivo a lista **não** é
    reordenada em React: ela chega pronta do banco, e `ListaDeEncaminhamentos` só filtra
    por nome.
    Esta ordem substituiu `data_encaminhamento DESC, id DESC`, que existia para o registro
    recém-cadastrado aparecer no topo, logo abaixo do formulário. Aquele papel ficou com a
    mensagem que a própria action devolve ("cadastrado"/"atualizado" para X): ela confirma
    o que acabou de ser digitado sem custar a ordem que serve para o resto do dia.
  - **Um encaminhamento por paciente, garantido por `UNIQUE`, não por `if`.** A regra
    (13 das obrigatórias) chegou depois da primeira versão da tela, que permitia várias
    linhas por paciente. Ela mora na migration
    `20260909140000_encaminhamento_unico_por_paciente`, e a Server Action passou de
    `INSERT` para `INSERT ... ON CONFLICT ("paciente_id") DO UPDATE`. A constraint **não é
    cinto de segurança redundante**: sem um índice único naquela coluna o `ON CONFLICT`
    nem é aceito pelo Postgres, então a regra e o upsert são a mesma peça vista de dois
    lados. A migration deduplica antes de criar o índice (mantém a linha de
    `data_encaminhamento` mais recente por paciente, desempate pelo maior `id`) — mesmo
    padrão do dedup de `paciente.nome`; na base real não havia duplicata, o que era o
    esperado numa feature recém-lançada, mas a migration precisa poder rodar sobre dados.
  - **O `SET` do upsert só toca em `data_encaminhamento`.** O vencimento se refaz sozinho:
    é coluna gerada, e o Postgres recusaria uma tentativa de escrevê-la também no ramo de
    update. Substituir um encaminhamento por outro de data diferente recalcula o
    vencimento sem uma linha de aritmética em TypeScript.
  - **"Atualizado" e "cadastrado" são palavras diferentes porque são eventos diferentes.**
    A action devolve `substituiuAnterior`, e a confirmação diz qual dos dois aconteceu. Sem
    isso, a linha antiga sumindo da lista logo abaixo do formulário pareceria bug. O sinal
    vem de olhar se a linha existia **antes** de gravar (`SELECT ... FOR UPDATE`, que de
    quebra serializa dois cadastros simultâneos do mesmo paciente) — não de adivinhar pelo
    resultado do upsert. É a mesma distinção de `scripts/seed-terapias.ts`.
  - **Quatro colunas: paciente, data, vencimento e situação.** A versão anterior desta tela
    tinha três, e pintava a *própria data* de carmim quando o vencimento já tinha passado.
    Isso foi substituído pelo selo, porque o que se comunica agora não é um sinal binário
    ("passou / não passou") e sim quatro estados; a data voltou a ser dado neutro, e o
    status tem coluna própria.
  - **Selo generalizado, não o `StatusBadge` antigo.** `StatusBadge` escreve o rótulo
    literal ("Regular" / "Renovar" / "Esgotada"), e nenhum dos três diz o que se quer dizer
    sobre um encaminhamento — reaproveitá-lo gastaria um vocabulário que significa outra
    coisa em todas as outras telas. **Essa decisão continua de pé**; o que mudou é que a
    *forma* do selo subiu para `components/selo-de-status.tsx` (geometria, sem
    vocabulário), e as duas telas passaram a montar o próprio mapa de apresentação em cima
    dela — `APRESENTACAO` no painel, `APRESENTACAO_DE_VENCIMENTO` em
    `selo-de-vencimento.tsx`. Mesma decisão, e pelo mesmo motivo, do get-or-create que
    subiu para `lib/domain/pacientes.ts` ao ganhar o segundo consumidor.
  - **Os três rótulos, e por que só duas cores.** "Vencido" é carmim sólido com texto
    branco e peso 700 — o mesmo tratamento do "Esgotada", o status crítico do sistema.
    "Vence este mês" e "A vencer" são os dois âmbar: **nenhuma quarta cor saturada entrou
    no sistema**. A urgência entre eles se distingue por preenchimento e peso, o mesmo
    recurso que já separa "Renovar" de "Regular" — "Vence este mês" é fundo preenchido com
    anel, "A vencer" é só contorno sobre papel. Ícones distintos (`OctagonAlert`,
    `TriangleAlert`, `CalendarClock`) e o filete de margem de 3px
    (`MARCADOR_POR_VENCIMENTO`, com âmbar rebaixado no "A vencer") completam os canais
    redundantes.
  - **Sem selo é uma resposta, não um vazio.** Vencimento a dois ou mais meses fica com a
    célula neutra e o filete transparente. Um quarto rótulo ("Em dia") cobraria atenção
    justamente da linha que não precisa de nenhuma.
  - **Resumo de contagem no topo, igual ao do painel.** Mesma folha dividida por filete,
    mesmos contadores em serifada 44px, mesma legenda embaixo (`ResumoDeVencimentos`).
    Reflete a lista inteira, não o filtro de busca — é painel de alerta, não resultado de
    consulta. Os sem-status não entram em contador nenhum.
  - **Busca por nome, o mesmo filtro do painel**: client-side sobre a lista já renderizada,
    com `normalizarParaBusca` (sem acento, sem caixa) para "Joao" achar "João". Se um dia
    a lista pesar, os dois viram `searchParams` + consulta no banco ao mesmo tempo. A lista
    é plana, sem recolher nem selecionar: cada paciente tem no máximo um encaminhamento, e
    a forma da tela é a regra de unicidade aparecendo na interface.
  - **O status é decidido em SQL**, na view `encaminhamento_status`, contra o
    `CURRENT_DATE` do banco — não comparando datas em JavaScript: é o mesmo relógio que a
    view de saldo usa para o alerta de validade, e o do Node (UTC na Vercel) discordaria
    dele à noite no horário de Brasília.
  - **Largura `max-w-5xl`**, a de "Atendimentos de hoje", não a de formulário
    (`max-w-[46rem]`): a tela é majoritariamente uma lista, e o formulário é uma faixa
    dentro dela.
  - **As duas colunas `DATE` viajam como texto** `"AAAA-MM-DD"`, como `validade` e
    `data_atendimento`, e são formatadas para `DD/MM/AAAA` só na tela pelo `formatarData`
    que já existia.

- **Deploy Vercel + Supabase Postgres (verificado em 01/09/2026)**:
  - URLs confirmadas sem expor segredo: `DATABASE_URL` está em
    `postgresql://vigia_app.[project-ref]:[senha]@aws-0-us-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1`;
    `DIRECT_DATABASE_URL` usa a mesma credencial `vigia_app.[project-ref]` na porta `5432`,
    sem `pgbouncer=true`; `DATABASE_SUPERUSER_URL` usa `postgres.[project-ref]` na porta
    `5432`.
  - Antes das migrations, o Supabase real estava vazio (`public` sem tabelas base). O role
    `postgres` foi checado com `rolcreatedb = true`; depois disso
    `npm run db:migrate:deploy` aplicou as 3 migrations do histórico do Prisma e
    `npm run db:migrate:status` confirmou `Database schema is up to date!`.
  - **RLS não está no histórico do Prisma.** O `ENABLE ROW LEVEL SECURITY` das 6 tabelas
    vive em `scripts/supabase/enable-rls.sql` e é rodado manualmente uma vez contra o
    Supabase (SQL Editor ou `psql`), separado do `db:migrate:deploy`. O motivo: o
    histórico em `prisma/migrations` é schema portável e roda também contra o Postgres
    local via `db:migrate:dev`, onde não existe o role `vigia_app` com `BYPASSRLS` — ligar
    RLS por lá derrubaria o login em desenvolvimento. Os grants de `vigia_app` (e o
    próprio `BYPASSRLS`) foram feitos manualmente antes e também não estão no script.
  - RLS foi verificado com
    `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';`: as 6
    tabelas de domínio (`paciente`, `usuario`, `terapia`, `requisicao`,
    `requisicao_terapia`, `atendimento`) estão com `rowsecurity = true`. O Supabase também
    reportou `_prisma_migrations` com RLS ativo. O role `vigia_app` continua com
    `rolbypassrls = true`, então ignora RLS mesmo com ele ativado.
  - A collation do banco Supabase é `datcollate = datctype = en_US.UTF-8`, não `C/POSIX`.
  - Revalidação obrigatória contra a pooled real do Supabase:
    `npm test -- atendimentos.integration guias.integration` passou com 2 arquivos e 18
    testes. Os testes de portão + `pg_stat_activity` confirmaram que `SELECT ... FOR
UPDATE` dentro de transação Prisma continua serializando corretamente no Supavisor em
    modo transação: no lançamento concorrente só o primeiro lote é aceito, e em duas
    edições concorrentes só a primeira edição que cabe no saldo é aceita. A integração de
    exclusão de guia também passou contra o mesmo banco. Depois disso, a suíte completa
    (`npm test`) passou contra o Supabase real com 12 arquivos e 166 testes; o teste de
    integração de saldo usa timeout explícito de 30s para não depender do limite padrão de
    5s em banco remoto.
  - `SESSION_SECRET` e `ADMIN_PASSWORD` novos foram gerados em 01/09/2026 sem gravar no
    repositório. `SESSION_SECRET` vai na Vercel; `ADMIN_PASSWORD` fica só no terminal local
    ao rodar `npm run create-admin`.
  - **Revalidação de concorrência refeita em 02/09/2026, depois de dois bugs de teste que
    só apareciam contra a pooled remota.** Ambos estão descritos em detalhe nas decisões
    de implementação do Prompt 6 (portão no `finally`, `apagarCenario` resiliente,
    `aquecerPool`, `maxWait` explícito). O resumo do porquê de nenhum dos dois aparecer no
    Postgres local: no local a conexão abre em milissegundos, então o `maxWait` padrão de
    2s nunca estourava e a asserção de bloqueio nunca falhava — e, sem asserção falhando
    antes do `portao.abrir()`, o defeito da limpeza também nunca era exercitado. Contra o
    Supabase os dois se combinaram: a asserção de bloqueio falhava por falta de conexão,
    a transação A ficava com o lock de pé pelos 30s, o `afterAll` estourava com
    `Hook timed out in 10000ms` no meio dos `DELETE` e sobrava paciente/requisição/terapia
    órfãos (a guia, primeiro `DELETE`, chegava a sair — foi essa a assinatura do lixo).
  - Resultado da revalidação: `npm test` passou 4 vezes seguidas contra o Supabase real,
    12 arquivos e 166 testes, sem nenhuma falha intermitente. Os dois blocos de corrida
    confirmam o bloqueio real de B pelo `pg_stat_activity` (fora do pool do Prisma), o
    saldo final correto (`qtd_utilizada = 2` na guia de 3; `qtd_utilizada = 4` na guia de 5) e uma varredura do banco depois de cada rodada devolveu 0 linhas residuais. A
    correção da limpeza foi validada injetando uma falha logo após a asserção de bloqueio,
    numa cópia descartável do arquivo: os dois testes falham como esperado, o `afterAll`
    completa sem estourar e o banco fica em 0 órfãos. A injeção foi revertida.

### Exclusão permanente de paciente — e a ressalva sobre guarda de prontuário

**O que o sistema faz:** na aba Encaminhamentos, o botão "Excluir" de uma linha apaga o
**paciente inteiro** — a linha de `encaminhamento`, todas as `requisicao`, todas as
`requisicao_terapia` e todos os `atendimento` que pendem delas. São `DELETE` de verdade,
numa transação só, sem soft-delete, sem coluna `apagado_em`, sem tabela de arquivo morto e
sem nenhuma forma de desfazer pela aplicação. Depois do commit, a única recuperação
possível é backup do banco.

**A ressalva, que foi levantada antes de a decisão ser tomada:** o CFM exige guarda de
prontuário médico por no mínimo 20 anos a partir do último registro, com guarda
**permanente** quando o prontuário está em meio digital. Um DELETE físico é incompatível
com essa exigência — não é uma questão de configuração, é o oposto do que a norma pede.
Isso foi dito ao usuário, que decidiu prosseguir assim mesmo, ciente da consequência. A
decisão é dele e está registrada aqui para quem chegar depois não interpretar como
descuido: **foi deliberado, não esquecido**. Se a exigência voltar à mesa, o caminho é
soft-delete (coluna de exclusão lógica + filtro em toda leitura) ou uma tabela de arquivo
morto — nenhum dos dois é o que está implementado hoje.

**Por que a exclusão é do paciente e não do encaminhamento.** Ela nasce de uma linha da
tela de encaminhamentos, mas apaga o cadastro inteiro por causa da regra 15: paciente sem
encaminhamento não pode ter requisição. Apagar só o encaminhamento deixaria as requisições
existentes num estado que o próprio sistema recusa criar — legais por terem nascido antes,
ilegais para nascer agora. Uma linha daquela tela *é* um paciente (a `UNIQUE (paciente_id)`
garante), então "excluir a linha" e "excluir o paciente" são a mesma frase dita de dois
jeitos.

**A ordem dos DELETE é do banco, não de gosto** (`excluirPacienteNaTransacao`, em
`lib/domain/pacientes.ts`): `requisicao_terapia` -> `requisicao` -> `encaminhamento` ->
`paciente`. As três FKs envolvidas são `ON DELETE RESTRICT`, então qualquer outra ordem é
recusada pelo Postgres. Os `atendimento` **não** têm DELETE próprio: eles vão embora pelo
`ON DELETE CASCADE` de `atendimento -> requisicao_terapia`, o único cascade do sistema
(regra 10). Escrever o DELETE explícito também funcionaria e foi recusado de propósito —
seria uma segunda descrição de uma regra que já mora no schema, e as duas divergiriam no
primeiro ajuste que só uma delas recebesse.

**O `FOR UPDATE` no paciente** não é só contra duas exclusões simultâneas. Ao inserir um
filho, o Postgres pega `FOR KEY SHARE` na linha referenciada, e `FOR UPDATE` conflita com
ele: uma criação de requisição concorrente para o mesmo paciente fica esperando a exclusão
terminar e então falha na FK, em vez de escorregar entre a contagem e o `DELETE`.

**A fricção da confirmação é o produto, não enfeite** (`excluir-paciente.tsx`). Três
escolhas, todas por causa do tamanho do risco:

1. **O clique no botão consulta o banco antes de abrir o diálogo.** As contagens de
   requisições e atendimentos são lidas (`contarParaExclusao`), e a frase cita os números
   reais: "Isso vai apagar permanentemente o cadastro de X, incluindo N requisição(ões) e
   N atendimento(s). Essa ação não pode ser desfeita." "Todos os dados relacionados" seria
   mais fácil de escrever e não diria nada — 0 atendimentos e 300 atendimentos são
   decisões diferentes.
2. **A confirmação é digitada.** O botão só habilita depois de a palavra `EXCLUIR` ser
   escrita num campo dentro do diálogo. Dois cliques em "sim" seguidos são, na prática, um
   gesto só. Foi escolhida uma palavra fixa em vez do nome do paciente porque o nome está
   escrito na própria frase logo acima do campo: copiá-lo dali é reflexo, não leitura.
3. **O diálogo não fecha no erro**, como o `ExcluirGuia` do painel: `preventDefault` no
   clique impede o Radix de fechar, e a mensagem devolvida pela action aparece dentro do
   diálogo.

Nada disso é validação: o cliente é contornável. O que não é contornável é o
`requireUsuario()` da Server Action (regra 4) e a validação do id no domínio. Um POST
montado à mão com um id válido apaga o paciente — do mesmo jeito que um POST montado à mão
exclui uma guia. A diferença é o tamanho da consequência, e ela está registrada acima.

**O teste do rollback não usa gancho de teste no código de produção.** O parâmetro `tx`
que `excluirPacienteNaTransacao` já recebia serve de costura: o teste passa um `Proxy` que
estoura no segundo `$executeRaw`, com o cenário montado **commitado** (o único do
`pacientes.integration.test.ts` que escreve no banco para valer, e limpa no `finally`).
Sem transação, esse cenário perderia as guias e os atendimentos e manteria a requisição, o
encaminhamento e o paciente — um prontuário mutilado, que é pior que um apagado por
parecer íntegro na tela.

## Não fazer

- Não recriar o campo `arquivada` em `requisicao_terapia` (foi removido no sistema
  original, sem uso).
- Não guardar `validade` em `requisicao` — ela pertence a `requisicao_terapia`.
- Não usar `localStorage`/sessão em memória do servidor para autenticação — sessão é
  sempre cookie assinado (iron-session), sem estado no servidor.
- Não fazer nenhum código da aplicação (fora dos scripts de migration) importar
  `DATABASE_SUPERUSER_URL`.
- Não replicar a fórmula de saldo/status em mais de um lugar em TypeScript como fonte de
  verdade — a view SQL é a fonte de verdade; TypeScript só espelha para testes.
- Não calcular o vencimento de encaminhamento em TypeScript em lugar nenhum — nem em
  produção, nem como espelho de teste. A coluna gerada é a única fonte, e o banco recusa
  a escrita de qualquer jeito.
- Não trocar os 180 dias corridos por seis meses de calendário para "bater com a
  planilha" — a divergência é deliberada e está registrada nas decisões de implementação.
- Não classificar o status de encaminhamento em TypeScript, nem por dias. A comparação é
  de **mês de calendário** e mora na view `encaminhamento_status`; TypeScript só conta o
  que ela classificou.
- Não reordenar a listagem de encaminhamentos no cliente (`sort` em React, `useMemo` que
  reordena). A ordem — status por prioridade, depois `lower(nome)` — vem do `ORDER BY` da
  consulta; o componente só filtra. E não transformar aquele `CASE` de prioridade em
  coluna da view nem em campo do tipo da linha: ele é ordenação de leitura, não
  classificação.
- Não permitir mais de um encaminhamento por paciente "resolvendo na aplicação" (apagar o
  antigo antes de inserir, checar existência e ramificar). A `UNIQUE (paciente_id)` é o
  que garante a regra, e é ela que dá arbítrio ao `ON CONFLICT` do upsert.
- Não usar `StatusBadge` (nem os rótulos Regular/Renovar/Esgotada) fora do vocabulário de
  `status_alerta`. Para uma tela com outro vocabulário, montar um mapa de apresentação em
  cima de `components/selo-de-status.tsx` — e sem introduzir cor saturada nova.
- Não reimplementar busca/criação de paciente por nome: use `obterOuCriarPaciente` de
  `lib/domain/pacientes.ts`. Uma segunda implementação com outra regra de comparação
  discordaria do índice `UNIQUE (lower(nome))`.
- Não declarar `encaminhamento.data_vencimento` no `schema.prisma` sem o
  `@default(dbgenerated(...))` exato da introspecção — sem ele o próximo `migrate dev`
  gera uma migration que o Postgres recusa.
- Não versionar `lib/generated/prisma`. A pasta está no `.gitignore` e é refeita pelo
  `postinstall` (`prisma generate`) em qualquer clone. Ela ficou rastreada por engano até
  09/09/2026, de quando foi commitada antes da regra existir — `.gitignore` não afeta
  arquivo já rastreado —, e o efeito era uma pasta meio-versionada: o
  `models/Encaminhamento.ts` nunca entrou, e cada `prisma generate` sujava o `git status`
  com dez arquivos que ninguém lê em revisão. Resolvido com `git rm --cached`, sem tocar
  no disco.
- Não colocar configuração específica do Supabase (RLS, grants, roles) em
  `prisma/migrations` — esse histórico é schema portável e roda também no Postgres local.
  Esse tipo de configuração vai em `scripts/supabase/`, rodado à mão.
- Não transformar a regra 15 em "encaminhamento em dia". A exigência é de **existência**:
  um encaminhamento vencido conta. Se um dia a clínica quiser exigir vigência, isso é uma
  conversa a ter, não uma dedução a fazer — e há teste de integração que cai de propósito
  se alguém apertar a regra em silêncio.
- Não checar o encaminhamento **antes** da transação de `criarRequisicao` (nem em
  `validarEntrada`). Antes dela não existe `paciente_id`: um nome novo ainda não é
  paciente nenhum. E não trocar o `throw` da recusa por um `return { ok: false }` — é o
  `throw` que desfaz o paciente que o get-or-create acabou de criar.
- Não acrescentar `DELETE FROM atendimento` à exclusão de paciente. Os atendimentos vão
  pelo `ON DELETE CASCADE` que já existe no schema; o DELETE explícito seria uma segunda
  descrição da mesma regra.
- Não transformar a exclusão de paciente em soft-delete "só por segurança", nem
  acrescentar lixeira, arquivo morto ou coluna `apagado_em` por conta própria. A exclusão
  física é decisão registrada do usuário, tomada com a exigência de guarda de prontuário
  já na mesa — mudá-la é conversa com ele, não refatoração.
- Não afrouxar a confirmação da exclusão (habilitar o botão sem o campo digitado, estimar
  as contagens em vez de consultá-las, fechar o diálogo no erro). A fricção é o produto
  daquela tela, não um obstáculo a ser polido.
- Não repetir que "o sistema não tem perfis". Tinha, até 17/09/2026; não tem mais. A
  afirmação sobrevive em comentários e resumos antigos — ao encontrá-la, corrija em vez de
  propagar.
- Não decidir acesso pelo `papel` do **cookie**. Ele é cópia envelhecida, selada no último
  login; quem decide é `requireUsuario()` / `getUsuarioAtual()`, que lê o banco. O papel no
  cookie existe só para o `proxy.ts` poder ser barato — e "barato" ali significa
  aproximação otimista, exatamente como a checagem de sessão que já mora lá.
- Não repor o `DEFAULT 'admin'` em `usuario.papel`. Ele existe apenas dentro da migration
  `20260917120000_papel_de_usuario`, como mecanismo de backfill, e é derrubado no comando
  seguinte. Um default permanente faria toda inserção que esquecesse o papel virar admin
  em silêncio, e ainda poria `schema.prisma` e banco em desacordo. Há teste que cai.
- Não acrescentar um papel novo só no `CHECK` da migration ou só em `PAPEIS`
  (`lib/auth/papel.ts`). São duas metades da mesma definição e mudam no mesmo commit.
- Não reescrever a lógica idempotente de criação de conta dentro de um script novo. Ela
  vive em `criarOuAtualizarUsuario` (`lib/auth/criar-usuario.ts`); um terceiro script de
  conta lê o ambiente dele e chama essa função.
- Não fazer `create-recepcao` cair em `ADMIN_USERNAME`/`ADMIN_PASSWORD` (nem o contrário)
  "para reaproveitar". O par separado é o que impede um comando de mexer na conta errada —
  e há teste que lê os dois fontes e afirma isso.
- Não decidir permissão a partir do cookie fora do `proxy.ts`. O papel do cookie é cópia
  que envelhece: ele serve para o desvio otimista e nada mais. Página e Server Action
  decidem pelo papel do banco (`requireAcessoARota` / `autorizarRota`) — ver a regra 17 e
  "Controle de acesso por papel".
- Não escrever a regra de acesso em dois lugares. `podeAcessarRota` (`lib/auth/acesso.ts`)
  é a única fonte: proxy, páginas/actions e menu leem dela. Um menu que decida por conta
  própria é um menu que um dia vai discordar da permissão de verdade.
- Não esconder link achando que isso protege. O item do menu some por conveniência; quem
  barra são as duas camadas de backend.

## Progresso

- [x] Prompt 0 — Setup inicial do projeto
- [x] Prompt 1 — Schema do banco de dados (Prisma), migrations, seed
- [x] Prompt 2 — Autenticação (login, logout, proteção de rotas em duas camadas, script
      de admin idempotente)
- [x] Prompt 3 — Regras de domínio (saldo e status): espelho em TypeScript da view em
      `lib/domain/saldo.ts`, testes unitários de borda e teste de integração que compara o
      espelho com a view (Vitest)
- [x] Prompt 4 — Dashboard (hoje `/klini/dashboard`): resumo por status, lista agrupada por
      paciente, busca client-side, exclusão de guia com confirmação e histórico de
      atendimentos em diálogo (a validação de status que este prompt acrescentou à
      exclusão foi revertida depois — ver regra 9)
- [x] Prompt 5 — Cadastro de nova requisição (hoje `/klini/requisicoes/nova`): formulário com
      autocomplete de paciente (`datalist`), lista dinâmica de terapias, validação no
      cliente e no servidor, Server Action transacional com get-or-create
      case-insensitive do paciente e unicidade de `numero_requisicao` por paciente,
      redirect para o dashboard com toast de sucesso
- [x] Prompt 6 — Lançamento de atendimento (hoje `/klini/atendimentos/novo`): formulário com
      seleção de paciente, data padrão vinda do `CURRENT_DATE` do banco, observação
      opcional e carga sob demanda das guias com `saldo_restante > 0`; Server Action
      transacional que trava as guias com `SELECT ... FOR UPDATE` em ordem de id antes
      de ler o saldo na view, recusa lote vazio, guia repetida, créditos não inteiros
      ou <= 0, guia inexistente e saldo insuficiente; sucesso limpa o formulário sem
      navegar. Teste de integração força duas transações concorrentes na mesma guia e
      confirma que só uma passa
- [x] Prompt 7 — Histórico, edição e exclusão de atendimento — implementação e
      testes prontos; pendente teste manual no navegador porque esta sessão não expôs
      um browser controlável
- [x] Prompt 8 — Página "Atendimentos de hoje": lista simples em
      `/klini/atendimentos/hoje`, usando `CURRENT_DATE` do banco e ordenação por nome
      do paciente, sem filtros extras
- [x] Prompt 9 — Relatório semanal por e-mail
- [x] Correção do cron do relatório semanal (09/09/2026) — `/api/cron/relatorio-semanal`
      era interceptado pelo `proxy.ts` e redirecionado para `/login` (307) antes da
      checagem de `CRON_SECRET`. Rotas sob `/api/cron/` passaram a dispensar a triagem de
      sessão, com teste de regressão em `lib/auth/proxy.test.ts` cobrindo proxy + rota
      juntos. Ver "Cron interceptado pelo proxy" nas decisões de implementação
- [x] Passagem de design visual — sistema de design aplicado a login, painel, nova
      requisição, lançar atendimento, atendimentos de hoje e aos diálogos de
      histórico/edição/exclusão. Sem mudança de regra de negócio, Server Action ou
      consulta. Ver "Sistema de design" nas decisões de implementação
- [x] Painel: pacientes recolhidos por padrão (com o pior status no cabeçalho) e botão
      de copiar "Nome - Número da requisição". Só apresentação. Ver "Painel com pacientes
      recolhidos e botão de copiar" nas decisões de implementação
- [x] Prompt 10 — Deploy no Vercel/Supabase: conexão pooled/direct conferida,
      migrations aplicadas no Supabase real vazio, RLS ativo nas 6 tabelas de domínio
      (por `scripts/supabase/enable-rls.sql`, fora do histórico do Prisma),
      Prisma 7 documentado com `@prisma/adapter-pg`, `postinstall` confirmado, variáveis
      de Vercel/local documentadas no README e testes de concorrência revalidados contra
      a pooled real. O texto/branding visível já diz "VIGIA"; o cookie de sessão e o
      `name` do `package.json` continuam com o nome antigo, o que não é visível ao usuário
- [x] Revalidação de concorrência contra o Supabase (02/09/2026) — **última pendência do
      deploy, fecha o Prompt 10**. `npm test` verde 4x seguidas (12 arquivos, 166 testes)
      contra a pooled real, bloqueio de B confirmado por `pg_stat_activity` fora do pool,
      saldos finais corretos e 0 linhas residuais no banco depois de cada rodada. Dois
      bugs de teste foram corrigidos no caminho, ambos invisíveis no Postgres local: (1) o
      portão da transação A não estava num `finally`, então uma asserção que falhasse
      antes do `portao.abrir()` deixava o lock de pé por 30s, travava o `afterAll` nos
      `DELETE` e deixava paciente/requisição/terapia órfãos em produção; (2) o `maxWait`
      padrão de 2s do Prisma é menor que os ~2,4s que uma conexão nova ao Supabase leva
      para abrir, o que fazia a própria asserção de bloqueio falhar de forma intermitente.
      Ver "Revalidação de concorrência refeita em 02/09/2026" no bloco de deploy
- [x] Encaminhamentos (hoje `/klini/encaminhamentos`) — tabela `encaminhamento` com
      `data_vencimento` como coluna gerada (`data_encaminhamento + INTERVAL '180 days'`),
      tela única com formulário inline no topo (autocomplete de paciente + data), listagem
      de três colunas abaixo, `requireUsuario()` na Server Action e link novo no menu.
      Reaproveita o get-or-create de paciente, movido para `lib/domain/pacientes.ts`.
      `tsc --noEmit` limpo, `npm test` verde (15 arquivos, 198 testes) e `npm run build`
      ok. **Pendente: teste manual no navegador** — esta sessão não expôs um browser
      controlável, do mesmo jeito que aconteceu no Prompt 7. O que foi verificado sem
      navegador: a rota responde e é protegida pelo proxy (307 para
      `/login?next=%2Fencaminhamentos`), e três cadastros em sequência pelo caminho real
      da action (`criarEncaminhamento` -> `listarEncaminhamentos`) gravam, aparecem na
      lista e trazem o vencimento exato do banco. Ver "Encaminhamentos" nas decisões de
      implementação
- [x] Encaminhamentos, segunda passagem (09/09/2026) — três mudanças na mesma tela:
      (1) **unicidade por paciente**, com `UNIQUE (paciente_id)` na migration
      `20260909140000_encaminhamento_unico_por_paciente` (dedup antes de criar o índice;
      não havia duplicata na base) e a action passando de `INSERT` para upsert, com a
      confirmação distinguindo "atualizado" de "cadastrado"; (2) **status por mês de
      calendário** na view `encaminhamento_status`
      (`20260909140100_view_encaminhamento_status`), lido pronto pela listagem; (3)
      **passagem visual** — selo generalizado (`components/selo-de-status.tsx`), coluna de
      situação, resumo de contagem no topo e busca por nome, todos no vocabulário do
      painel. `tsc --noEmit` limpo, `npm test` verde (15 arquivos, 210 testes) e
      `npm run build` ok; `npm run lint` continua acusando só o erro pré-existente de
      `acoes-da-guia.tsx`. Verificação sem navegador controlável, de novo, mas mais funda
      que a da vez anterior: a página foi **renderizada de verdade** (dev server + cookie
      de sessão selado à mão) com uma linha em cada um dos quatro casos, e o HTML traz o
      resumo (1 / 2 / 1), os selos com as classes certas e as células neutras onde não há
      status. Pelo caminho real da action, cadastrar para um paciente que já tinha
      substitui a linha e recalcula o vencimento. **Continua pendente** só a interação de
      navegador (digitar, filtrar, ver o toast)
- [x] Encaminhamentos, ordenação por status (09/09/2026) — a listagem passou de
      `data_encaminhamento DESC, id DESC` para **status por prioridade e, dentro dele,
      `lower(nome)`**: Vencido, Vence este mês, A vencer, sem marcação. Mudou só o
      `ORDER BY` de `listarEncaminhamentos` (um `CASE` sobre o rótulo que a view já
      produz, usado só para ordenar) — nada de coluna nova, view alterada ou `sort` em
      React. A consulta foi extraída para `listarEncaminhamentosComCliente`, com
      `listarEncaminhamentosNaTransacao` ao lado, mesmo par de
      `excluirAtendimentoComCliente`: é o que deixa o teste de integração ler a lista pela
      consulta de verdade e desfazer tudo no fim. Dois testes novos: um monta os quatro
      casos com nomes em ordem alfabética **invertida** em relação ao status (Zulmira
      vencida, Ana sem marcação) mais um par na mesma categoria ("Ordem aurora" e
      "Ordem Beatriz") e afirma a ordem exata; o outro é o controle desse par, comparando
      as duas strings `COLLATE "C"` para mostrar que por byte a ordem seria a inversa —
      sem ele o desempate passaria com ou sem `lower()`, porque a collation do banco local
      (`Portuguese_Brazil.1252`) já ignora caixa. O primeiro teste foi conferido contra o
      `ORDER BY` antigo: falha, como tem que falhar. `tsc --noEmit` limpo, `npm test` verde
      (15 arquivos, 212 testes) e `npm run build` ok; `npm run lint` continua acusando só
      o erro pré-existente de `acoes-da-guia.tsx`. A listagem também foi conferida contra
      o banco de desenvolvimento pela função real, e volta na ordem certa com os seis
      encaminhamentos de demonstração. **Pendente: a conferência visual no navegador**,
      que ficou para o usuário — esta sessão não teve browser controlável. Ver "Ordem da
      lista" nas decisões de implementação
- [x] Encaminhamento obrigatório antes de requisição + exclusão permanente de paciente
      (09/09/2026, branch `feat/exclusao-paciente-completa`) — duas mudanças ligadas pela
      mesma regra nova. (1) **Regra 15**: `criarRequisicao` passou a exigir uma linha em
      `encaminhamento` para o `paciente_id` resolvido, dentro da mesma transação e logo
      depois do get-or-create; a recusa é lançada, então um nome novo digitado pela
      primeira vez é rejeitado **sem deixar paciente órfão**. A exigência é só de
      existência — encaminhamento vencido conta, e há teste que prova isso lendo o status
      da view antes de criar. (2) **Exclusão permanente**: botão "Excluir" em cada linha
      da listagem de encaminhamentos, que apaga o paciente inteiro
      (`requisicao_terapia` -> `requisicao` -> `encaminhamento` -> `paciente`, com os
      atendimentos indo por cascade) numa transação só, precedido de um diálogo que
      **consulta o banco** para citar as contagens reais e exige digitar `EXCLUIR` para
      habilitar o botão. Arquivos novos: `lib/domain/pacientes-mensagens.ts`,
      `lib/domain/pacientes-actions.ts`,
      `app/(app)/klini/encaminhamentos/excluir-paciente.tsx`,
      `lib/domain/pacientes.integration.test.ts`. `EncaminhamentoNaLista` ganhou
      `pacienteId` — a exclusão é do paciente, e resolver o paciente a partir do
      encaminhamento seria depender de uma linha que some no mesmo instante.
      Consequência registrada na regra 15: `pacienteCriado` nunca mais é `true` num
      sucesso de `criarRequisicao`. `tsc --noEmit` limpo, `npm test` verde (16 arquivos,
      226 testes), `npm run build` ok e `npm run lint` continua acusando só o erro
      pré-existente de `acoes-da-guia.tsx`. Verificado sem navegador controlável (de novo:
      nenhuma sessão até agora expôs um): um script pelo caminho real do domínio contra o
      banco de desenvolvimento confirmou os seis passos — recusa do nome novo, zero
      paciente órfão, requisição aceita depois do encaminhamento, contagem do diálogo
      (1 requisição / 2 guias / 3 atendimentos) lida do banco, exclusão bem-sucedida e
      zero linha restante nas cinco tabelas —, e a página foi **renderizada por HTTP** com
      cookie de sessão selado à mão: 200, coluna "Ações" presente e um botão
      `aria-label="Excluir cadastro de …"` por linha (tabela e lista móvel). Ver "Exclusão
      permanente de paciente" nas decisões de implementação. **Pendente: a interação de
      navegador** — ver o roteiro nas pendências conhecidas
- [x] Terapia acrescentada a requisição já existente (14/09/2026, branch
      `feat/adicionar-terapia-requisicao-existente`) — "Nova requisição" deixou de recusar
      o `numero_requisicao` que o paciente já tem e passou a **acrescentar** as terapias
      do formulário à requisição existente, sob o mesmo `requisicao_id`. **Nenhuma
      mudança de schema e nenhuma migration**: o índice único
      `(paciente_id, numero_requisicao)` continua igual, e o que mudou foi o
      comportamento em cima dele. O `SELECT` que já existia antes do insert virou a
      escolha entre os dois desfechos em vez de uma recusa; `ResultadoCriacao` ganhou
      `requisicaoCriada` e `terapiasAdicionadas`, e a confirmação passou a distinguir
      "Requisição criada para X" de "N terapia(s) adicionada(s) à requisição Y de X"
      (`mensagemDeCriacao`, mesmo padrão criado/atualizado dos encaminhamentos). O
      `P2002` continua tratado, mas só cobre a corrida do primeiro cadastro e agora pede
      reenvio em vez de outro número (`erroCorridaNaRequisicao` substituiu
      `erroNumeroDuplicado`). A regra 15 e o get-or-create do paciente não foram tocados.
      `tsc --noEmit` limpo, `npm test` verde (16 arquivos, 233 testes), `npm run build`
      ok e `npm run lint` continua acusando só o erro pré-existente de
      `acoes-da-guia.tsx` — confirmado rodando o lint também com as mudanças guardadas,
      para não sobrar dúvida de origem. Testes novos de integração: a segunda submissão
      devolve o **mesmo** `requisicaoId`, sobra **uma** linha em `requisicao` para o par e
      **quatro** em `requisicao_terapia` (1 + 3), a view `requisicao_terapia_saldo`
      calcula certo tanto na guia antiga (que ganhou atendimento depois do acréscimo)
      quanto nas recém-chegadas — Renovar por saldo, Renovar por validade dentro dos 7
      dias, Regular e Esgotada —, e o acréscimo com uma linha ruim (terapia inexistente
      ou `qtd_autorizada = 0`) não grava **nenhuma** das linhas novas, nem a que passaria
      sozinha. O caso "mesmo número em outro paciente" continua criando requisição
      própria. Verificado sem navegador controlável (de novo: nenhuma sessão até agora
      expôs um): um script pelo caminho real do domínio contra o banco de desenvolvimento
      fez os dois envios commitados e leu o painel por `listarGuiasDoDashboard` —
      1 linha em `requisicao`, 4 em `requisicao_terapia`, e as quatro terapias saindo
      sob o mesmo número. **Pendente: a interação de navegador** — ver o roteiro nas
      pendências conhecidas
- [x] Exclusão de guia liberada em qualquer status (15/09/2026, branch
      `fix/permitir-exclusao-guia-regular`) — **reversão deliberada da regra 9**, a pedido
      explícito do usuário: o bloqueio de exclusão quando o status era `"Regular"` era
      decisão de implementação do Prompt 4, não pedido original, e causava fricção no uso
      real (cadastro errado, terapia duplicada por engano). Saíram a checagem de status em
      `excluirGuiaNaTransacao`, as constantes `ERRO_GUIA_REGULAR` e
      `STATUS_QUE_PERMITEM_EXCLUSAO`, e a consulta do `status_alerta` que só existia para
      alimentá-la — a exclusão não lê mais a view. Na UI, `AcoesDaGuia` deixou de esconder
      "Excluir guia": ele aparece em toda guia, como "Histórico". **Nada mais mudou**: o
      `SELECT ... FOR UPDATE` continua travando a linha (agora é ele quem detecta a guia
      inexistente), o cascade dos atendimentos é o mesmo e o diálogo de confirmação
      continua no caminho. Testes invertidos em vez de apagados: no unitário, `Regular`
      entrou no `it.each` dos três status que são excluídos com sucesso, mais um caso novo
      que exige que o `status_alerta` **não seja consultado** (a regressão de recolocar a
      checagem precisa dele) e o antigo teste de ordem virou "trava com FOR UPDATE antes de
      apagar", por `invocationCallOrder`; na integração, os três status viraram um
      `it.each` com o mesmo desfecho — guia apagada e zero atendimento órfão —, e o caso de
      guia inexistente cobre o `FOR UPDATE` contra o Postgres real. A exclusividade da
      trava não é observável de dentro de uma transação que sofre rollback (outra conexão
      nem enxerga a guia), e isso ficou escrito no teste. `tsc --noEmit` limpo, `npm test`
      verde (16 arquivos, 235 testes, com a integração rodando contra o banco real),
      `npm run build` ok e `npm run lint` continua acusando só o erro pré-existente de
      `acoes-da-guia.tsx` — confirmado rodando o lint com as mudanças guardadas.
      **Teste manual no navegador, enfim feito** (esta sessão teve browser controlável —
      Edge do sistema via Playwright instalado com `--no-save` e removido depois): guia
      `Regular` criada no banco de desenvolvimento (20 autorizados, 2 consumidos, sem
      validade), aberta no dashboard com cookie de sessão selado à mão — o botão "Excluir
      guia" aparece na linha com o selo "Regular", o diálogo de confirmação abre com o
      texto certo (terapia, paciente, número da requisição e o aviso do cascade),
      confirmar fecha o diálogo sem mensagem de erro, o resumo do topo cai de 7 para 6 em
      "Regular" e o paciente some da lista. No banco, guia apagada e **zero** atendimento
      órfão. Os dados de teste foram removidos no fim.
- [x] Validade sugerida em "Nova requisição" (15/09/2026, branch
      `feat/validade-automatica-1-mes`) — o campo "Validade (opcional)" de cada linha de
      terapia passou a nascer preenchido com `CURRENT_DATE + INTERVAL '1 month'` lido do
      banco, nos dois desfechos da regra 5 (requisição nova e terapia acrescentada a uma
      existente), porque é o mesmo formulário. **Nenhuma mudança de schema, nenhuma
      migration e nenhuma mudança na regra de `status_alerta`** — a view continua
      decidindo `Renovar` por `validade <= CURRENT_DATE + 7 days`; o efeito pretendido é
      que a guia sem uso entre sozinha em `Renovar` por volta de um mês depois de criada,
      em vez de ficar `Regular` para sempre por ter nascido sem validade. Entrou
      `validadePadraoDeGuia` em `lib/domain/requisicoes.ts` (com `referencia` opcional só
      para o teste mirar fronteiras de mês); `page.tsx` a busca no mesmo `Promise.all` das
      listas e a passa como prop; `linhaNova` no formulário ganhou o segundo argumento, o
      que faz o TypeScript cobrar os três pontos onde uma linha nasce — a inicial, a de
      "Adicionar outra terapia" e a que volta depois da limpeza do sucesso. `tsc --noEmit`
      limpo, `npm test` verde (16 arquivos, 244 testes, com a integração contra o banco
      real), `npm run build` ok e `npm run lint` continua acusando só o erro pré-existente
      de `acoes-da-guia.tsx`. Testes novos de integração: sete fronteiras de mês com alvos
      literais (31/01 -> 28/02, e 29/02 em ano bissexto; 30/01 -> 28/02, que 30 dias
      fixos errariam; 31/08 -> 30/09; 31/12 -> 31/01; um dia comum; 29/02 -> 29/03), a
      prova de que o ponto de partida é o `CURRENT_DATE` do banco (comparando com a
      própria função aplicada a `dataDeHoje()`, em vez de repetir a fórmula) e um envio
      pelo domínio com uma linha de validade digitada por cima e outra apagada — grava a
      digitada e `NULL`, nunca a sugerida. **Teste manual no navegador feito** (Edge do
      sistema via `playwright-core` instalado com `--no-save` e removido depois): a página
      abre com `15/10/2026` já no campo sem ninguém digitar, as duas linhas de "Adicionar
      outra terapia" nascem com a mesma data, editar a segunda para `09/03/2027` e apagar
      a terceira e enviar grava exatamente `2026-10-15`, `2027-03-09` e `NULL`, as três
      saindo `Regular` na view; um segundo envio com o mesmo número para o mesmo paciente
      anexou a quarta guia sob o mesmo `requisicao_id` (1 linha em `requisicao`, 4 em
      `requisicao_terapia`) e ela também levou a validade sugerida. Os dados de teste
      foram removidos no fim.

- [x] **Fase A — Papel de usuário** (17/09/2026, branch `feat/papel-de-usuario`, **não
      mesclada**: validação local do usuário primeiro). Reverteu a premissa "sem perfis"
      registrada desde o início deste documento. Entrou: a coluna `usuario.papel` (TEXT
      `NOT NULL`, `CHECK (papel IN ('admin', 'recepcao'))`, sem default) pela migration
      `20260917120000_papel_de_usuario`, que backfilla `'admin'` nas linhas existentes e
      derruba o default em seguida; `lib/auth/papel.ts` com `PAPEIS` / `PapelUsuario` /
      `ehPapelValido`, espelho em TypeScript do CHECK; `lib/auth/criar-usuario.ts` com a
      regra idempotente única; `scripts/create-admin.ts` gravando `papel = 'admin'`
      explicitamente e `scripts/create-recepcao.ts` (novo, lendo `RECEPCAO_USERNAME` e
      `RECEPCAO_PASSWORD`, com o script `create-recepcao` no `package.json`) gravando
      `'recepcao'`; `papel` e `username` no cookie de sessão; `papel` no retorno de
      `getUsuarioAtual()` / `requireUsuario()`, lido do banco. **Nenhuma rota e nenhuma
      permissão dependem de papel** — isso é a Fase C.
      `tsc --noEmit` limpo, `npm test` verde (18 arquivos, 255 testes, com a integração
      contra o banco real), `npm run build` ok e `npm run lint` continua acusando só o
      erro pré-existente de `acoes-da-guia.tsx`. Testes novos: unitários do espelho
      `PAPEIS`, e integração cobrindo os dois scripts gravando o papel certo, a
      idempotência (segunda passada redefine a senha — verificada com `verifyPassword` nos
      dois sentidos —, mantém uma linha só, o mesmo id e o papel), a reativação de conta
      desativada, a recusa do Postgres a papel fora da lista, e o backfill. O teste do
      backfill **roda o SQL do arquivo de migration**, lido do disco, sobre uma cópia
      temporária semeada com as linhas reais de `usuario` mais duas "antigas" (uma ativa e
      uma inativa): a cópia existe porque o role de runtime não é dono de `usuario` e o
      Postgres recusa o `ALTER TABLE` dele — separação de privilégio que está correta —, e
      o que muda entre o arquivo e o que roda é só o nome da tabela. O estado final da
      tabela de verdade é conferido à parte, no catálogo (`NOT NULL`, sem default, CHECK
      com os dois papéis).
      **Verificação local por SQL feita**: `admin` (id 1) e `codex_teste` (id 6), que já
      existiam, saíram da migration com `papel = 'admin'`; `npm run create-admin` rodado
      duas vezes mantém `admin` em `papel = 'admin'` e imprime "atualizado" nas duas;
      `npm run create-recepcao` criou `recepcao_teste` (id 44) com `papel = 'recepcao'` e,
      na segunda passada, atualizou a mesma linha sem duplicar; sem `RECEPCAO_PASSWORD` o
      script recusa com mensagem própria. O `information_schema` confirma `papel` TEXT,
      `is_nullable = NO`, `column_default` nulo, e o CHECK
      `papel = ANY (ARRAY['admin', 'recepcao'])`.
      **Teste manual no navegador não foi feito** — esta sessão não teve browser
      controlável. O que falta verificar na mão é o login: ele grava `papel` e `username`
      no cookie agora, e nenhum teste automatizado exercita a Server Action `login` de
      ponta a ponta.

- [x] Fase B do plano de papéis e convênios — as quatro telas mudaram de lugar:
      `app/(app)/{dashboard,requisicoes,atendimentos,encaminhamentos}/` passaram a viver
      debaixo de `app/(app)/klini/`, e as URLs ganharam o prefixo `/klini`. Nenhuma regra
      de papel entrou aqui — isso é a Fase C. Ficaram **fora** do `klini/` de propósito:
      `app/(auth)/login` (o login é compartilhado entre convênios), `app/api/auth/logout`
      (infraestrutura de auth) e `app/api/cron/relatorio-semanal` (o relatório é do fluxo
      klini hoje, mas é rota de API agendada, não tela; mover o caminho quebraria o
      `vercel.json` e o cron da Vercel sem ganho nenhum nesta fase).
  - **Bookmarks antigos dão 404, de propósito.** Não foi criado redirect de
    compatibilidade de `/dashboard` para `/klini/dashboard`: são duas pessoas usando uma
    ferramenta interna, e um redirect legado é código que ninguém lembraria de apagar.
  - **A superfície de mudança foi menor do que parecia, e o motivo importa:** este código
    **não usa `revalidatePath(caminho)`** em lugar nenhum. As Server Actions de mutação
    chamam o `refresh()` do Next 16 (`next/cache`), que não recebe caminho — ele redesenha
    a rota corrente. Nenhuma delas chama `redirect` também (ver a decisão "sem navegar
    depois de lançar atendimento"). Ou seja: criar requisição, lançar atendimento,
    cadastrar encaminhamento e excluir guia **não têm acoplamento nenhum com o caminho da
    URL**, e continuariam corretos mesmo se alguém tivesse esquecido de varrer o
    repositório. O que de fato precisou mudar foi só link (`href`), o `redirect` da raiz,
    o teste do proxy e a documentação.
  - **O `proxy.ts` não mudou uma linha, e isso foi verificado, não suposto.** O `matcher`
    é um padrão genérico que só *exclui* `api/cron` e os estáticos — ele não lista rota
    por rota. Como `(app)` é grupo de rotas e não aparece na URL, `/klini/*` já cai dentro
    dele automaticamente. Verificado em execução: sem cookie, as cinco rotas novas dão 307
    para `/login` com o `next=` certo (`/login?next=%2Fklini%2Fdashboard`); com cookie de
    sessão válido, as cinco dão 200 e `/` redireciona para `/klini/dashboard`.
  - **Teste interativo no navegador ainda não foi feito** — esta sessão também não teve
    browser controlável. O que foi verificado sem ele: `tsc --noEmit` limpo (depois de
    `npx next typegen`, porque os tipos de rota em `.next/types` ficam obsoletos quando a
    árvore de rotas muda e apontam para os arquivos antigos), 255 testes verdes, `next
    build` listando as rotas já sob `/klini/`, e o HTML renderizado das telas sem nenhum
    `href` fora de `/klini` — o menu inteiro, o "Nova requisição" do painel e o "Cancelar"
    do formulário. Falta clicar: criar requisição, lançar atendimento e excluir guia pelo
    navegador.
  - **Não foi para produção sozinha, e não deve ir.** Mover as rotas sem as regras de
    acesso da Fase C deixaria a recepção alcançando telas que deveria ter bloqueadas. As
    duas fases sobem juntas.

- [x] Fase C do plano de papéis e convênios (17/09/2026, branch
      `feat/controle-de-acesso-por-papel`) — o papel passou a barrar. A regra de negócio
      17 diz o que vale; "Controle de acesso por papel" nas decisões de implementação diz
      como e por quê. Em código: `lib/auth/acesso.ts` (a regra, num lugar só), `proxy.ts`
      (camada otimista), `requireAcessoARota`/`autorizarRota` em
      `lib/auth/current-user.ts` (camada autoritativa) usados nas duas páginas restritas e
      nas quatro actions delas (criar requisição, cadastrar/substituir encaminhamento,
      contar e excluir paciente), `app/(app)/itens-de-navegacao.ts` (menu) e
      `app/(app)/page.tsx` (escolha de convênio).
  - **Verificado com `tsc --noEmit` limpo, 276 testes verdes e `next build` ok.** `npm run
    lint` continua acusando só o erro pré-existente de `acoes-da-guia.tsx`. Testes novos:
    a tabela de permissões (`lib/auth/acesso.test.ts`), o desvio do proxy com cookie
    selado de verdade (`lib/auth/proxy.test.ts`), a recusa das quatro actions com o papel
    vindo de um Prisma dublê (`lib/domain/acesso-por-papel.test.ts` — o que se troca por
    dublê é só o que está *abaixo* da decisão: a sessão e o banco) e o menu por papel
    (`app/(app)/itens-de-navegacao.test.ts`, primeiro teste dentro de `app/`; o `include`
    do Vitest passou a cobrir `app/**/*.test.ts`).
  - **`vitest.config.mts` ganhou um alias para `server-only`.** O pacote só exporta o
    módulo vazio na condição `react-server`, que o Next resolve e o Vitest não — sem o
    alias, qualquer teste que importe um módulo marcado como servidor (como
    `lib/auth/current-user.ts`) falha no import.
  - **Verificação de ponta a ponta feita por HTTP** (esta sessão também não teve browser
    controlável; o que se fez foi dirigir o servidor de produção local em `next start`,
    logando de verdade pelas contas `codex_teste`/admin e `recepcao_teste`/recepção, com a
    Server Action de login exercitada pelos campos ocultos do fallback sem JavaScript — ou
    seja, o login de ponta a ponta, que nenhum teste automatizado cobre, rodou aqui).
    Resultados: como recepção, `/klini/requisicoes/nova`, `/klini/encaminhamentos`,
    `/sulamerica/dashboard` e `/` devolvem 307 para `/klini/dashboard`, e as três telas
    dela devolvem 200; como admin, todas devolvem 200 e a raiz traz a escolha com os dois
    cartões; o HTML do painel da recepção não tem nenhum `href` para as rotas restritas
    (nem no menu, nem no botão "Nova requisição"), e o do admin tem os cinco itens.
  - **A camada autoritativa foi provada sem a ajuda do proxy**, e o jeito de fazer isso
    está registrado porque não é óbvio: um POST da action restrita a partir de outra rota
    **não funciona** — o Next escopa o id da action por rota e responde 500 ("Failed to
    find Server Action") antes de qualquer código nosso. O que funciona é o **cookie
    desatualizado**: logar como admin, rebaixar aquela conta para `recepcao` no banco e
    reusar o cookie antigo. O proxy lê "admin" no cookie e deixa passar; a página
    redireciona para `/klini/dashboard` e o POST das duas actions volta com `{"erro":"Seu
    usuário não tem permissão para esta ação."}` no payload, sem criar nada (conferido no
    banco: nenhum paciente novo). É exatamente o cenário que a regra 4 descreve — o cookie
    envelhece, o banco não.
  - **Falta o clique no navegador de verdade.** O que foi exercido por HTTP cobre rota,
    redirect, action e HTML renderizado; o que não foi é a interação (clicar no cartão do
    convênio, ver o toast de recusa numa aba velha).
  - **Não vai para produção sozinha:** sobe junto com a Fase B, pelo motivo registrado no
    item dela.

### Plano de papéis e convênios — 4 fases

Registrado aqui inteiro de propósito: a Fase A sozinha não explica por que existe, e as
sessões seguintes precisam do plano completo para não implementar a fase errada primeiro.

- [x] **Fase A — Papéis de usuário.** A coluna `usuario.papel`, os dois scripts de criação
      de conta, e o papel disponível nos dois lugares (sessão e busca autoritativa no
      banco). Só o dado. Detalhes no item acima.
- [x] **Fase B — Reorganização de rotas por convênio.** As rotas passam a ser organizadas
      por convênio. Vem antes do controle de acesso porque é o que define *o que* há para
      permitir; inverter a ordem faria a Fase C ser refeita em cima de rotas que mudaram.
      Detalhes no item correspondente do progresso.
- [x] **Fase C — Controle de acesso.** Aqui, e só aqui, `papel` passou a barrar: o `papel`
      do cookie ganhou uso (desvio otimista no `proxy.ts`, sem bater no banco) e o papel
      do banco ganhou quem recusa com ele (`requireAcessoARota` e `autorizarRota`, ao lado
      de `requireUsuario`). Detalhes no item correspondente do progresso.
- [ ] **Fase D — SulAmérica.** O convênio novo, em cima da estrutura das fases B e C. A
      tela de escolha da raiz já linka para `/sulamerica/dashboard`, que dá 404 até esta
      fase existir. Quando ela existir, decidir explicitamente se a recepção entra: o
      allowlist de `lib/auth/acesso.ts` a deixa de fora por padrão.

## Pendências conhecidas (não bloqueiam o próximo passo, mas não esquecer)

- Nome do cookie de sessão ainda é `klini_session` e o header interno é
  `x-klini-pathname` — nenhum dos dois é visível ao usuário; trocar o cookie derruba todas
  as sessões abertas, então fica para uma janela combinada. O `name` do `package.json`
  também continua "klini".
- `app/(app)/klini/dashboard/acoes-da-guia.tsx` tem um erro de lint pré-existente
  (`react-hooks/set-state-in-effect`, no `useEffect` de `LinhaDoHistorico` que recarrega os
  campos ao entrar em edição). Não foi tocado pela passagem visual porque é lógica de
  estado, não estilo — mas `npm run lint` falha por causa dele.
- `ADMIN_PASSWORD` e `RECEPCAO_PASSWORD` de produção devem ficar só no terminal local ao
  rodar `npm run create-admin` / `npm run create-recepcao`; não versionar e não configurar
  na Vercel.
- **Duas contas de teste ficaram no banco de desenvolvimento, com senhas conhecidas por
  quem leu esta sessão.** `recepcao_teste` (id 44, papel `recepcao`) e `codex_teste` (id
  6, papel `admin`) tiveram a senha redefinida em 17/09/2026 para a verificação da Fase C
  — as duas com senhas escolhidas na hora e escritas no terminal. Nenhuma das duas existe
  em produção, e a conta `admin` (id 1) **não** foi tocada. Antes de usar qualquer uma
  delas para validar no navegador, rode `npm run create-recepcao` / `npm run create-admin`
  com uma senha sua; se não for usar, apague a linha. `codex_teste` também foi rebaixada a
  `recepcao` e devolvida a `admin` durante o teste do cookie desatualizado — o estado
  final conferido no banco é `admin`.
- **Nenhum teste automatizado exercita a Server Action `login` de ponta a ponta.** Não é
  novo — mas ficou mais visível com a Fase A, que passou a gravar `papel` e `username` no
  cookie. Os campos do cookie são cobertos pelo tipo, não por teste. Na Fase C o login foi
  exercitado **à mão** contra o servidor local, com as duas contas, e o `papel` selado no
  cookie foi confirmado pelo comportamento do proxy — mas continua sem teste automatizado.
- **A unicidade case-insensitive de `paciente.nome` depende da collation da instalação.**
  O banco local verificado em 31/08/2026 usa `Portuguese_Brazil.1252`; o Supabase de
  produção verificado em 01/09/2026 usa `en_US.UTF-8`. Nenhum dos dois é `C/POSIX`.
  Num Postgres futuro criado com `--locale=C`, `lower()` só dobra ASCII e `'JOSÉ SILVA'`
  passaria a conviver com `'José Silva'` — sem erro nenhum, só duplicando o paciente. Se
  isso aparecer em um ambiente novo, a saída é trocar o índice para
  `CREATE UNIQUE INDEX ... ON paciente (lower(nome COLLATE "pt-BR-x-icu"))` (ou criar o
  banco com a collation certa) — e a mesma expressão precisa ser usada no get-or-create de
  `lib/domain/pacientes.ts` (ele morava em `requisicoes.ts` quando esta nota foi escrita),
  senão busca e constraint voltam a discordar.
- **Teste manual do navegador na tela de encaminhamentos** ainda não foi feito — nenhuma
  sessão até agora expôs um browser controlável. O que já foi verificado sem ele está no
  progresso (a página renderizada por HTTP, com os quatro casos e as classes certas); o
  que falta é a parte interativa. Roteiro: cadastrar dois ou três encaminhamentos em
  sequência pelo formulário do topo sem recarregar a página, confirmando que cada um
  aparece na lista, que o formulário limpa o nome e devolve o foco, e que a data de
  vencimento exibida é `data_encaminhamento + 180 dias` exatos; depois cadastrar de novo
  para um paciente **que já está na lista**, com data diferente, e confirmar que a linha
  antiga some (só uma linha para ele), que o vencimento foi recalculado e que o toast diz
  "atualizado", não "cadastrado"; e digitar no campo de busca para ver a lista filtrar sem
  o resumo do topo se mexer. Desde 09/09/2026 o roteiro ganhou mais um passo: conferir
  a olho que a lista sai na ordem **Vencido -> Vence este mês -> A vencer -> sem
  marcação**, e que dentro de cada bloco os nomes estão em ordem alfabética ignorando
  caixa.
- **Teste manual no navegador das duas mudanças de 09/09/2026** (regra 15 + exclusão
  permanente) ainda não foi feito — de novo, nenhum browser controlável nesta sessão. O
  que já foi verificado sem ele está no progresso. Roteiro, na ordem:
  1. Em "Nova requisição", digitar um nome de paciente **que não esteja na lista de
     encaminhamentos**, escolher uma terapia e enviar. Confirmar a mensagem "Paciente sem
     encaminhamento cadastrado. Cadastre o encaminhamento antes de criar uma requisição."
     e que o formulário continua na tela com o que foi digitado.
  2. Conferir no banco (ou no `datalist` de pacientes, recarregando a página) que **esse
     nome não virou paciente**. É o ponto do rollback.
  3. Cadastrar o encaminhamento desse paciente e repetir a requisição: agora passa.
  4. Lançar dois ou três atendimentos nas guias criadas, para o cenário ter contagem que
     não seja zero.
  5. Na aba Encaminhamentos, clicar em "Excluir" na linha desse paciente. Conferir que o
     botão mostra "Verificando..." por um instante (é a consulta ao banco) e que a frase
     do diálogo traz a contagem **exata** de requisições e atendimentos que foram
     lançados — não um número redondo, não "todos os dados".
  6. Conferir que o botão "Excluir tudo" começa **desabilitado**, que continua
     desabilitado com o campo vazio ou com texto errado, e que só habilita depois de
     `EXCLUIR` (aceita `excluir` e espaço nas pontas).
  7. Confirmar. A linha some da lista, o resumo do topo se ajusta e o toast diz o que foi
     apagado. Depois, procurar o paciente no painel e em "Nova requisição": ele não pode
     aparecer em lugar nenhum.
  8. Cancelar um diálogo antes de confirmar (Esc e botão "Cancelar") e conferir que nada
     foi apagado e que o campo de confirmação volta vazio na próxima abertura.
- **Teste manual no navegador do acréscimo de terapia a requisição existente**
  (14/09/2026) ainda não foi feito — nenhum browser controlável nesta sessão. O que já foi
  verificado sem ele está no progresso. Roteiro:
  1. Em "Nova requisição", escolher um paciente **que já tenha encaminhamento**, digitar
     um número novo, escolher uma terapia e enviar. Confirmar o toast "Requisição criada
     para <paciente>." e que o formulário limpa e devolve o foco.
  2. Voltar em "Nova requisição" e enviar o **mesmo paciente com o mesmo número**, agora
     com outras três terapias (validades diferentes entre si, e pelo menos uma vazia).
     Confirmar que **não** aparece erro de duplicata e que o toast diz "3 terapias
     adicionadas à requisição <número> de <paciente>.".
  3. No painel, abrir esse paciente: as quatro terapias têm de aparecer **sob o mesmo
     número de requisição**, uma linha cada, sem a requisição aparecer duas vezes. Conferir
     que cada linha mostra a validade que foi digitada nela — a da primeira continua a
     dela.
  4. Lançar um atendimento numa das terapias antigas e outro numa das novas, e conferir
     que o saldo e o selo de status mudam só na linha certa.
  5. Repetir o envio com uma terapia **que já está na requisição**, com outra quantidade:
     tem de entrar como uma **segunda linha**, não substituir a primeira nem dar erro.
- **O banco de desenvolvimento local ficou com cinco encaminhamentos de demonstração**
  ("Zoe Vencida Manual", "Bruno Este Mes Manual", "Carla Fim Deste Mes Manual", "Diego A
  Vencer Manual", "Elisa Longe Manual"), um em cada caso da classificação, criados para a
  verificação de 09/09/2026 e deixados de pé justamente para esse teste manual de
  navegador. As datas foram miradas a partir do `CURRENT_DATE`, então **elas envelhecem**:
  daqui a um mês os status já não são os que os nomes dizem. Apagar quando o roteiro
  acima for cumprido; nada disso existe em produção.

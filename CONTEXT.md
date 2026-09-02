# VIGIA — Contexto do domínio

> Nota de nomenclatura: o sistema auditado originalmente (relatório de auditoria que deu
> origem a este documento) se chamava "klini". O produto novo, construído do zero em
> Next.js/Postgres, se chama **VIGIA**. Onde este documento ou o código ainda mencionar
> "klini", trate como o nome antigo/legado — o nome exibido para o usuário final
> (título da página, texto do header, e-mails) deve ser **VIGIA**.

Sistema de controle de autorizações de terapia de uma clínica. Não tem múltiplos perfis:
existe apenas "usuário autenticado e ativo" ou "não autenticado".

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
  paciente.nome), password_hash (bcrypt), ativo (bool, default true).
- **terapia**: id, nome (único), codigo_tiss (texto).
- **requisicao**: id, numero_requisicao (texto), paciente_id (FK). Único por
  `(paciente_id, numero_requisicao)` — não único globalmente.
- **requisicao_terapia** ("guia"): id, qtd_autorizada (int, CHECK > 0), validade (date,
  opcional), requisicao_id (FK), terapia_id (FK).
- **atendimento**: id, data_atendimento (date), creditos_consumidos (int, default 1,
  CHECK >= 0), observacao (texto, opcional), requisicao_terapia_id (FK,
  **ON DELETE CASCADE**).

Demais FKs (ex: requisicao → paciente) ficam no padrão `RESTRICT`. Só o caminho
atendimento → requisicao_terapia tem cascade — decisão já implementada e confirmada por
teste manual (exclusão de guia com atendimentos: cascade ok; exclusão de requisição com
guias vinculadas: falha, como esperado).

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
5. Criar requisição: get-or-create do paciente + criar `requisicao` + criar N linhas de
   `requisicao_terapia`, tudo em **uma transação atômica**.
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
9. Exclusão de guia: bloqueada no **backend** (não só escondida na UI) quando o status é
   `"Regular"` — correção deliberada em relação ao sistema legado, que só escondia o botão
   na interface.
10. Exclusão de guia apaga os atendimentos filhos via `ON DELETE CASCADE` no banco.
11. Relatório semanal: agrupa guias por paciente, mantém só pacientes com pelo menos uma
    guia `Renovar` ou `Esgotada`. Se a lista final estiver vazia, não envia e-mail.

## Decisões assumidas (o relatório de auditoria deixou como perguntas em aberto — revise se divergir do que você quer)

- `paciente.nome`: **único case-insensitive** no banco (índice `UNIQUE` sobre
  `lower(nome)`), para eliminar duplicados por corrida — o sistema antigo não tinha isso.
- `numero_requisicao`: único **por paciente** (não globalmente único), permitindo reuso de
  numeração entre pacientes diferentes mas não duplicata para o mesmo paciente.
- `qtd_autorizada`: deve ser **> 0** na criação da guia (rejeitar 0 no formulário); guias
  existentes com saldo zerado continuam caindo em `"Esgotada"` normalmente.
- Exclusão de guia `"Regular"` bloqueada no backend (ver regra 9 acima), não só na UI.
- Edição de atendimento para 0 créditos continua permitida (mantido do sistema original).

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
- **Página inicial (`/`)**: faz `redirect("/dashboard")` — não duplica o conteúdo do
  dashboard na rota raiz. O dashboard vive em `app/(app)/dashboard` como rota própria.
- **`middleware.ts` → `proxy.ts`**: no Next 16, o arquivo de middleware foi renomeado para
  `proxy.ts`. Isso é só uma mudança de nome de arquivo/convenção da framework, não afeta
  nenhuma regra de negócio.
- **Dashboard (`/dashboard`)**: leitura em Server Component, mutação em Server
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
- **Exclusão de guia trava a linha antes de decidir**: `excluirGuiaNaTransacao`
  faz `SELECT ... FOR UPDATE` em `requisicao_terapia` **antes** de ler o
  `status_alerta` da view. Sem isso, um lançamento de atendimento concorrente
  (regra 7, que trava as mesmas linhas) poderia mudar o saldo entre a checagem e
  o DELETE, e uma guia que voltou a ser "Regular" nesse intervalo seria apagada
  assim mesmo. Por isso a função recebe o cliente de transação em vez de abrir a
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
- **Script de admin idempotente**: `scripts/create-admin.ts` (rodado via
  `npm run create-admin`, lendo `ADMIN_USERNAME`/`ADMIN_PASSWORD` do `.env`) redefine a
  senha e reativa a conta se o usuário já existir, em vez de falhar por duplicata. É o
  jeito recomendado de resetar a senha do admin — evitar apagar/recriar via SQL manual.
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
- **Cadastro de requisição (`/requisicoes/nova`)**: leitura das listas (pacientes,
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
  - **`numero_requisicao` duplicado é checado duas vezes**: um `SELECT` antes do insert,
    para o usuário ver mensagem em vez de exceção, e a unique
    `requisicao_paciente_id_numero_requisicao_key` como rede de verdade — o `P2002` dela
    é traduzido para a mesma mensagem amigável. A pré-checagem sozinha tem janela de
    corrida; a unique sozinha só produziria erro cru.
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
- **Lançamento de atendimento (`/atendimentos/novo`)**: leitura da lista de pacientes e
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
    da guia funciona como ponto de encontro combinado: vale porque *todo* caminho que
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
    transação enxergar o *commit* da outra. A interleaving é forçada com um portão (a
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
    `pg_sleep` em paralelo). A transação B é a função de *produção*, que usa o `maxWait`
    padrão do Prisma (2s) para conseguir a conexão — e abrir uma conexão nova contra o
    Supabase remoto custa ~2,4s, medido. Sem aquecer, B morre com `P2028` **antes** de
    chegar ao `SELECT ... FOR UPDATE`: nenhuma conexão aparece esperando lock e o teste
    acusa "não bloqueou" sem ter chegado a exercitar o lock que ele existe para provar.
  - **Todo `$transaction` dos testes de integração leva `maxWait: 30_000` junto do
    `timeout: 30_000`.** `timeout` é o tempo *dentro* da transação; `maxWait` é o tempo
    para *consegui-la*, e o padrão de 2s é curto demais quando os 12 arquivos de teste
    rodam em paralelo contra a pooled do Supabase. Sem isso a suíte falha de forma
    intermitente com `P2028 Unable to start a transaction in the given time`, em arquivos
    diferentes a cada rodada — parece flakiness de concorrência e não é.
    A mesma medição vale para produção, onde uma conexão fria sozinha já estoura o padrão;
    a regra completa está em "Convenções de acesso ao banco", que é a fonte única — este
    bullet é só o registro de onde ela apareceu primeiro.

- **Sistema de design (passagem visual, aplicada a todas as telas do Prompt 2 ao 8)**.
  Vale para as telas novas dos Prompts 8-9 e para qualquer tela futura: seguir o que está
  aqui em vez de redescobrir as escolhas. O sistema inteiro mora em `app/globals.css`
  (tokens + três classes de componente) e em `app/(app)/dashboard/formato.ts` +
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
    reexportada por `app/(app)/dashboard/formato.ts`: é a mesma precedência do resumo do
    topo e do pior status do cabeçalho, e duas cópias acabariam divergindo.
  - **Cobertura**: as três funções puras têm teste unitário
    (`lib/domain/guias-apresentacao.test.ts`, 14 casos, incluindo o de múltiplas
    requisições). O comportamento de interface (recolhido por padrão, clique/Enter/Espaço,
    busca expandindo o resultado, clipboard) foi verificado **no navegador**, não em teste
    de componente: o projeto não tem jsdom nem testing-library, e o `environment` do Vitest
    é `node`. Montar esse aparato só para esta tela não se paga agora — se um dia entrar,
    é aqui que estes casos devem virar teste automatizado.

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
    saldo final correto (`qtd_utilizada = 2` na guia de 3; `qtd_utilizada = 4` na guia de
    5) e uma varredura do banco depois de cada rodada devolveu 0 linhas residuais. A
    correção da limpeza foi validada injetando uma falha logo após a asserção de bloqueio,
    numa cópia descartável do arquivo: os dois testes falham como esperado, o `afterAll`
    completa sem estourar e o banco fica em 0 órfãos. A injeção foi revertida.

## Convenções de acesso ao banco

- **Todo `prisma.$transaction` — de produção ou de teste — precisa de `maxWait` explícito,
  maior que o padrão do Prisma.** `maxWait` é o tempo para *conseguir* a transação (abrir
  ou pegar do pool a conexão em que ela vai rodar); `timeout` é o orçamento de trabalho
  *dentro* dela. São coisas diferentes e só a primeira está em jogo aqui.
  - **De onde veio a exigência**: a investigação que corrigiu a flakiness dos testes de
    concorrência contra a pooled do Supabase (02/09/2026, descrita em detalhe nas decisões
    de implementação do Prompt 6 e no bloco de deploy). Ela instrumentou o custo de abrir
    uma conexão nova contra o Supabase: **~2,4s**, contra os **2000ms** do `maxWait` padrão
    do Prisma. O padrão perde por uma margem estreita e constante, e o sintoma é
    `P2028 Unable to start a transaction in the given time`.
  - **Isso não é um problema só de teste.** Sem concorrência nenhuma, toda função
    serverless da Vercel que precise abrir a primeira conexão paga esses ~2,4s — ou seja,
    qualquer conexão fria em produção estourava o padrão. Foi por isso que a exigência
    virou convenção em vez de continuar como comentário local.
  - **Produção**: `OPCOES_DE_TRANSACAO` em `lib/db/transacao.ts` (`maxWait: 10_000`, ~4x de
    folga sobre os 2,4s medidos). É o que as quatro transações de produção usam —
    `lancarLote` e `editarAtendimentoPeloId` (`atendimentos.ts`), `excluirGuiaPeloId`
    (`guias.ts`) e `criarRequisicao` (`requisicoes.ts`). Transação nova em produção importa
    essa constante em vez de repetir o número.
  - **Testes de integração**: `{ maxWait: 30_000, timeout: 30_000 }`. O valor é maior que o
    de produção porque os 12 arquivos da suíte disputam a mesma pooled em paralelo — carga
    que uma requisição de produção não tem. Ali o `timeout` também sobe, porque os blocos
    de corrida seguram lock de propósito.
  - **O `timeout` de produção fica no padrão do Prisma (5s), de propósito.** O que estava
    errado era a espera *pela* conexão, não o trabalho dentro da transação; e o teste de
    corrida de `lancarLote` conta com esses 5s para dimensionar a janela em que observa B
    bloqueada no `pg_stat_activity`.
  - **Por que isso não aparece no Postgres local**: lá a conexão abre em milissegundos, o
    `maxWait` padrão nunca estoura e o defeito fica invisível. Só a pooled remota exercita
    esse caminho — foi assim que ele passou despercebido até a revalidação de deploy.

## Decisões de implementação

- **RLS (Row Level Security) no Supabase**: o RLS foi ativado nas 6 tabelas do projeto
  (`paciente`, `usuario`, `terapia`, `requisicao`, `requisicao_terapia`, `atendimento`).
  Em vez de escrever policies ou desativar o RLS, o role de produção usado por
  `DATABASE_URL` (`vigia_app`) recebeu `BYPASSRLS` diretamente. É o equivalente ao
  `service_role` do Supabase, mas aplicado ao role próprio da aplicação, já que a conexão
  é feita via Postgres direto pelo Prisma — e não pela API REST/PostgREST, que é onde o
  modelo de policies do Supabase faz sentido. O RLS permanece ativado como rede de
  segurança: qualquer conexão futura que não use explicitamente esse role continua sujeita
  às regras de RLS.

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
- Não abrir `prisma.$transaction` sem `maxWait` explícito. O padrão do Prisma (2s) é
  menor que o custo medido de uma conexão fria contra o Supabase (~2,4s) e vira `P2028`
  em produção. Ver "Convenções de acesso ao banco".
- Não colocar configuração específica do Supabase (RLS, grants, roles) em
  `prisma/migrations` — esse histórico é schema portável e roda também no Postgres local.
  Esse tipo de configuração vai em `scripts/supabase/`, rodado à mão.

## Progresso

- [x] Prompt 0 — Setup inicial do projeto
- [x] Prompt 1 — Schema do banco de dados (Prisma), migrations, seed
- [x] Prompt 2 — Autenticação (login, logout, proteção de rotas em duas camadas, script
      de admin idempotente)
- [x] Prompt 3 — Regras de domínio (saldo e status): espelho em TypeScript da view em
      `lib/domain/saldo.ts`, testes unitários de borda e teste de integração que compara o
      espelho com a view (Vitest)
- [x] Prompt 4 — Dashboard (`/dashboard`): resumo por status, lista agrupada por
      paciente, busca client-side, exclusão de guia validada no backend e
      histórico de atendimentos em diálogo
- [x] Prompt 5 — Cadastro de nova requisição (`/requisicoes/nova`): formulário com
      autocomplete de paciente (`datalist`), lista dinâmica de terapias, validação no
      cliente e no servidor, Server Action transacional com get-or-create
      case-insensitive do paciente e unicidade de `numero_requisicao` por paciente,
      redirect para o dashboard com toast de sucesso
- [x] Prompt 6 — Lançamento de atendimento (`/atendimentos/novo`): formulário com
      seleção de paciente, data padrão vinda do `CURRENT_DATE` do banco, observação
      opcional e carga sob demanda das guias com `saldo_restante > 0`; Server Action
      transacional que trava as guias com `SELECT ... FOR UPDATE` em ordem de id antes
      de ler o saldo na view, recusa lote vazio, guia repetida, créditos não inteiros
      ou <= 0, guia inexistente e saldo insuficiente; sucesso limpa o formulário sem
      navegar. Teste de integração força duas transações concorrentes na mesma guia e
      confirma que só uma passa
- [ ] Prompt 7 — Histórico, edição e exclusão de atendimento — implementação e
      testes prontos; pendente teste manual no navegador porque esta sessão não expôs
      um browser controlável
- [x] Prompt 8 — Página "Atendimentos de hoje": lista simples em
      `/atendimentos/hoje`, usando `CURRENT_DATE` do banco e ordenação por nome
      do paciente, sem filtros extras
- [x] Prompt 9 — Relatório semanal por e-mail
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

## Pendências conhecidas (não bloqueiam o próximo passo, mas não esquecer)

- Nome do cookie de sessão ainda é `klini_session` e o header interno é
  `x-klini-pathname` — nenhum dos dois é visível ao usuário; trocar o cookie derruba todas
  as sessões abertas, então fica para uma janela combinada. O `name` do `package.json`
  também continua "klini".
- `app/(app)/dashboard/acoes-da-guia.tsx` tem um erro de lint pré-existente
  (`react-hooks/set-state-in-effect`, no `useEffect` de `LinhaDoHistorico` que recarrega os
  campos ao entrar em edição). Não foi tocado pela passagem visual porque é lógica de
  estado, não estilo — mas `npm run lint` falha por causa dele.
- `ADMIN_PASSWORD` de produção deve ficar só no terminal local ao rodar
  `npm run create-admin`; não versionar e não configurar na Vercel.
- **A unicidade case-insensitive de `paciente.nome` depende da collation da instalação.**
  O banco local verificado em 31/08/2026 usa `Portuguese_Brazil.1252`; o Supabase de
  produção verificado em 01/09/2026 usa `en_US.UTF-8`. Nenhum dos dois é `C/POSIX`.
  Num Postgres futuro criado com `--locale=C`, `lower()` só dobra ASCII e `'JOSÉ SILVA'`
  passaria a conviver com `'José Silva'` — sem erro nenhum, só duplicando o paciente. Se
  isso aparecer em um ambiente novo, a saída é trocar o índice para
  `CREATE UNIQUE INDEX ... ON paciente (lower(nome COLLATE "pt-BR-x-icu"))` (ou criar o
  banco com a collation certa) — e a mesma expressão precisa ser usada no get-or-create de
  `lib/domain/requisicoes.ts`, senão busca e constraint voltam a discordar.

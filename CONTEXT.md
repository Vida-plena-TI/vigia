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

## Decisões assumidas (perguntas em aberto no relatório de auditoria original)

- `paciente.nome`: único case-insensitive no banco.
- `numero_requisicao`: único por paciente, não globalmente.
- `qtd_autorizada`: deve ser > 0 na criação da guia.
- Exclusão de guia `"Regular"` bloqueada no backend.
- Edição de atendimento para 0 créditos continua permitida.

## Decisões tomadas durante a implementação (não estavam no relatório original)

- **Status HTTP do login**: a regra "falha de login retorna 400" do sistema legado (que
  usava FastAPI + Jinja2 renderizando HTML direto) **não se aplica literalmente** aqui.
  Server Actions do Next.js sempre respondem 200 (payload RSC) por natureza da tecnologia.
  O requisito funcional real — erro exibido, nenhuma sessão criada, nenhum redirect —
  está preservado; o código de status HTTP em si não é consumido por nada no sistema
  (nenhum client-side código depende de checar `response.status === 400`). Divergência
  intencional, não é bug.
- **Separação de usuários de banco de dados**: `DATABASE_URL` aponta para um role
  restrito (sem `CREATEDB`/DDL) usado pelo Prisma Client em runtime pela aplicação.
  `DATABASE_SUPERUSER_URL` aponta para um usuário com privilégios administrativos
  (`postgres`), usado **somente** por migrations, nunca importado pelo código da
  aplicação. O script `scripts/run-with-superuser.mjs` sobrescreve `DATABASE_URL` com o
  valor de `DATABASE_SUPERUSER_URL` apenas no processo filho ao rodar
  `npm run db:migrate:dev` / `npm run db:migrate:deploy`. `shadowDatabaseUrl` no
  `schema.prisma` também aponta para o superusuário, já que o `migrate dev` precisa criar
  um banco temporário para detectar drift, e o role restrito não tem permissão para isso.
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
- [ ] Prompt 10 — Deploy no Vercel (incluir troca de todo texto/branding visível de
      "klini" para "VIGIA" antes do deploy final, se ainda não tiver sido feito)

## Pendências conhecidas (não bloqueiam o próximo passo, mas não esquecer)

- Header e título da página ainda mostram "klini" em vez de "VIGIA".
- Nome do cookie de sessão ainda é `klini_session`.
- `ADMIN_PASSWORD` usado localmente deve ser trocado antes de qualquer deploy real (não
  reusar a senha de desenvolvimento em produção).
- **A unicidade case-insensitive de `paciente.nome` depende da collation da instalação.**
  Hoje ela funciona porque o banco é `Portuguese_Brazil.1252` (ver "Collation do banco").
  Num Postgres criado com `--locale=C`, `lower()` só dobra ASCII e `'JOSÉ SILVA'` passaria
  a conviver com `'José Silva'` — sem erro nenhum, só duplicando o paciente. Antes de
  provisionar o banco de produção (Prompt 10), conferir com:
  `SELECT datcollate, datctype FROM pg_database WHERE datname = current_database();`
  Se vier `C` ou `POSIX`, a saída é trocar o índice para
  `CREATE UNIQUE INDEX ... ON paciente (lower(nome COLLATE "pt-BR-x-icu"))` (ou criar o
  banco com a collation certa) — e a mesma expressão precisa ser usada no get-or-create
  de `lib/domain/requisicoes.ts`, senão busca e constraint voltam a discordar.

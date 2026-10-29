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
> "Progresso": **as quatro fases (A, B, C e D) estão implementadas**. Desde a Fase C (17/09/2026) o
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

- **paciente**: id, nome (texto, indexado). **Só nasce pela aba Cadastro do convênio**
  (`cadastrarPaciente`, regras 23 e 24): get-or-create por nome ali; busca sem criação nos
  dois cadastros de encaminhamento e em "Nova requisição";
  comparação case-insensitive, nome sempre trimado antes de salvar/buscar. **Único case-insensitive**
  no banco via índice `UNIQUE (lower(nome))`. Desde 28/10/2026 também
  **numero_carteirinha** (texto, **NULL permitido**, `CHECK ~ '^[A-Za-z0-9]{5,25}$'`,
  único sem caixa via `UNIQUE (lower(numero_carteirinha)) WHERE numero_carteirinha IS NOT
  NULL`) e **crm_medico** (texto, **NULL permitido**, `CHECK ~ '^[0-9]{1,10}$'`) — regra 20.
  Desde 29/10/2026 também **convenio** (texto, **NULL permitido**, `CHECK (convenio IN
  ('klini', 'sulamerica'))` `paciente_convenio_valido`, sem default) — regra 23.
- **usuario**: id, username (único, comparação **case-sensitive** — diferente de
  paciente.nome), password_hash (bcrypt), ativo (bool, default true), **papel** (texto,
  `NOT NULL`, `CHECK (papel IN ('admin', 'recepcao'))`, **sem default**). O `papel` entrou
  em 17/09/2026 e reverteu a premissa de que não havia perfis — ver a nota no topo deste
  documento e "Papéis de usuário" nas decisões de implementação. As contas que já existiam
  foram backfilladas como `admin` pela migration `20260917120000_papel_de_usuario`.
- **terapia**: id, nome (único), codigo_tiss (texto).
- **requisicao**: id, numero_requisicao (texto), paciente_id (FK), **situacao** (texto,
  `NOT NULL`, `CHECK (situacao IN ('solicitada', 'aprovada'))`, **sem default**). Único
  por `(paciente_id, numero_requisicao)` — não único globalmente. A `situacao` entrou em
  26/10/2026 (regra 19); as requisições que já existiam foram backfilladas como
  `aprovada` pela migration `20261026130000_situacao_da_requisicao`.
- **requisicao_terapia** ("guia"): id, qtd_autorizada (int, CHECK > 0), validade (date,
  opcional), requisicao_id (FK), terapia_id (FK).
- **atendimento**: id, data_atendimento (date), creditos_consumidos (int, default 1,
  CHECK >= 0), observacao (texto, opcional), requisicao_terapia_id (FK,
  **ON DELETE CASCADE**).
- **encaminhamento**: id, paciente_id (FK, `RESTRICT` como as demais, **`UNIQUE`**),
  data_encaminhamento (date, NOT NULL), data_vencimento (date, **coluna gerada pelo
  Postgres** — ver "Vencimento de encaminhamento" abaixo). Um encaminhamento sempre
  pertence a um paciente **já cadastrado na Klini** (regra 24: o cadastro de
  encaminhamento não cria paciente desde 29/10/2026). **Um paciente tem no máximo um encaminhamento**: cadastrar outro
  substitui o anterior (regra 13). O status de vencimento não é coluna — vem da view
  `encaminhamento_status`.

- **plano_terapia** (29/10/2026, regra 23): id, paciente_id (FK **ON DELETE CASCADE**),
  terapia_id (FK `RESTRICT`), minutos_semanais (INT NOT NULL, `CHECK` > 0, <= 10080 e
  múltiplo de 15 — `plano_terapia_minutos_semanais_validos`). `UNIQUE (paciente_id,
  terapia_id)` (`plano_terapia_paciente_id_terapia_id_key`, que serve também de índice por
  `paciente_id`). **Só informativo**: nenhum campo calculado, nenhuma soma. Sem colunas de
  auditoria — nenhuma tabela do projeto tem.

- **autorizacao_sulamerica**: id, paciente_id (FK RESTRICT e UNIQUE), data_inicio
  (DATE NOT NULL), prazo_meses (INT NOT NULL, CHECK em 3, 6 ou 12), data_vencimento
  (DATE gerada STORED), **nome_medico** (TEXT, **NULL permitido**, `CHECK
  (char_length(btrim(nome_medico)) BETWEEN 3 AND 120)`, desde 28/10/2026, só SulAmérica —
  NULL nas autorizações antigas, obrigatório no formulário). Uma autorização por paciente,
  substituída por novo cadastro. O status mensal vem da view `autorizacao_sulamerica_status`
  (que **não** tem `nome_medico`: a listagem o lê da tabela). O paciente é compartilhado
  com o Klini; excluir esta autorização não exclui nenhum outro registro.

Demais FKs (ex: requisicao → paciente) ficam no padrão `RESTRICT`. Só dois caminhos têm
cascade: atendimento → requisicao_terapia e, desde 29/10/2026, plano_terapia → paciente
(regra 23). O primeiro é decisão já implementada e confirmada por
teste manual (exclusão de guia com atendimentos: cascade ok; exclusão de requisição com
guias vinculadas: falha, como esperado).

A exclusão completa de um paciente (regra 16) percorre essa cadeia `RESTRICT` à mão, de
baixo para cima, numa transação — e deixa os atendimentos e o plano de terapias para os
dois cascades que existem. Ver `excluirPacienteNaTransacao` em `lib/domain/pacientes.ts`.

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
5. Criar requisição: **busca** do paciente (sem criar — regra 21) + checagem do
   encaminhamento (regra 15) + criar `requisicao` + criar N linhas de
   `requisicao_terapia`, tudo em **uma transação atômica**.
   **Uma requisição é uma pasta numerada, não um evento.** Terapias entram nela ao longo
   do tempo, e não só no minuto em que ela nasce. Por isso o cadastro tem dois desfechos,
   decididos pela existência de uma linha em `requisicao` para
   `(paciente_id, numero_requisicao)`:
   - **número inédito para aquele paciente** — cria a `requisicao` e pendura as N linhas
     de `requisicao_terapia` nela (o caminho de sempre);
   - **número que aquele paciente já tem** — **não** cria segunda `requisicao`; cada
     terapia do envio vai para o `requisicao_id` que já existe, de um de dois jeitos:
     - **terapia que a requisição ainda não tem** — INSERT de uma linha nova de
       `requisicao_terapia`;
     - **terapia que a requisição já tem** (mesmo `terapia_id`) — **UPDATE** de
       `qtd_autorizada` e `validade` na guia que já está lá. Nunca segunda guia, e nunca
       DELETE + INSERT: o `id` da guia não muda e os atendimentos dela continuam
       pendurados nele (o DELETE os levaria pelo `ON DELETE CASCADE`). A view recalcula o
       saldo com a quantidade nova.
   **Uma guia por terapia dentro da requisição** — garantido no banco pela UNIQUE
   `requisicao_terapia_requisicao_id_terapia_id_key` (desde 26/10/2026). Isto **reverte**
   a decisão de 14/09/2026, que tratava a mesma terapia repetida como "segunda
   autorização" e inseria outra linha — ver "Terapia repetida atualiza a guia existente"
   nas decisões de implementação. Repetir a mesma terapia em duas linhas **do mesmo envio**
   é recusado (`ERRO_TERAPIA_REPETIDA_NO_ENVIO`, apontando a segunda linha). A `validade`
   continua sendo de cada `requisicao_terapia`, nunca da requisição: uma terapia
   acrescentada hoje a uma pasta antiga carrega a validade dela própria, sem tocar nas guias
   das outras terapias.
6. Só terapias com `saldo_restante > 0` aparecem na tela de lançar atendimento.
7. Lançamento de atendimento em lote:
   - pelo menos 1 terapia selecionada;
   - não pode repetir o mesmo `requisicao_terapia_id` no mesmo lote;
   - `creditos_consumidos` deve ser inteiro **> 0**;
   - falha se a guia não existe;
   - falha se o saldo já está esgotado ou se os créditos pedidos excedem o saldo
     disponível;
   - usa `SELECT ... FOR UPDATE` (transação) travando as guias envolvidas em ordem
     determinística por id, para evitar deadlock e corrida de saldo;
   - falha (o lote **inteiro**) se qualquer guia for de requisição `solicitada` — regra 19.
     As requisições das guias são travadas com `FOR SHARE`, por id, **depois** das guias.
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
15. **Encaminhamento é pré-requisito de requisição** (reforçada em 28/10/2026 pela regra
    21). Não se cria requisição para um paciente que não tenha uma linha em
    `encaminhamento`. Dentro da transação de `criarRequisicao`
    (`lib/domain/requisicoes.ts`), nesta ordem e antes de qualquer escrita:
    - `buscarPacientePorNome` procura o nome (`lower(nome) = lower($1)`, trimado) e
      **trava a linha com `FOR KEY SHARE`**; nome de ninguém → "Paciente não
      cadastrado. Cadastre primeiro o encaminhamento em Encaminhamentos." e **nada é
      criado** (a requisição não cria mais paciente);
    - paciente achado sem encaminhamento Klini (legado de antes desta regra, ou criado
      pelo encaminhamento da SulAmérica) → a recusa de sempre, "Paciente sem encaminhamento cadastrado.
      Cadastre o encaminhamento antes de criar uma requisição.".
    O lock é o mesmo `FOR KEY SHARE` que o INSERT da requisição já pediria na linha do
    paciente, só que tomado antes das checagens: ele conflita com o `FOR UPDATE` da
    exclusão de paciente, que é o único caminho que apaga um encaminhamento — então
    paciente e encaminhamento não somem entre a checagem e o INSERT. Não conflita com o
    `FOR NO KEY UPDATE` do cadastro de encaminhamento. A recusa continua **lançada**
    (`ErroDeNegocio`), para desfazer qualquer escrita anterior da transação.
    A exigência é de **existência, não de validade**: qualquer encaminhamento serve,
    inclusive um já vencido — a consulta é à tabela `encaminhamento`, não à view
    `encaminhamento_status`. **Não exige carteirinha nem CRM**: paciente antigo com
    encaminhamento e sem esses dados continua recebendo requisição (decisão deliberada,
    regra 21). O campo `pacienteCriado` do resultado de `criarRequisicao`, que sob esta
    regra nunca era `true` num sucesso, **saiu** em 28/10/2026: a requisição não cria
    paciente, então ele não teria mais o que dizer.
16. **Exclusão de paciente é permanente, completa e sem desfazer.** A partir da listagem
    de encaminhamentos, excluir apaga o paciente inteiro — encaminhamento, requisições,
    guias e atendimentos — em `DELETE` real, numa única transação. Não há soft-delete,
    arquivamento nem lixeira. Ver "Exclusão permanente de paciente" nas decisões de
    implementação, inclusive a ressalva sobre guarda de prontuário.

17. **Acesso por papel (17/09/2026, Fase C).** `admin` tem acesso irrestrito — a tudo que
    existe hoje e a toda rota nova, sem precisar ser cadastrada em lugar nenhum.
    `recepcao` alcança **somente** `/klini/dashboard`, `/klini/atendimentos/novo`,
    `/klini/atendimentos/hoje` e a raiz `/`; qualquer outro caminho a manda para
    `/klini/dashboard`. Na prática, o que fica de fora é "Nova requisição",
    "Encaminhamentos" (inclusive a exclusão permanente de paciente, que só existe lá) e,
    desde 29/10/2026, as duas abas "Cadastro" (`/klini/pacientes`, `/sulamerica/pacientes`). A
    raiz `/` ramifica: admin vê a tela de escolha de convênio, recepção é redirecionada
    direto para `/klini/dashboard`, sem ver escolha nenhuma. Quem não tem permissão vai
    para `/klini/dashboard`, **não** para `/login`: a pessoa está autenticada: falta
    permissão, não identificação — e mandá-la ao login faria o `next=` trazê-la de volta
    para a mesma parede. A regra é decidida num lugar só, `podeAcessarRota` em
    `lib/auth/acesso.ts`, e é escrita como **lista do que a recepção pode**, não do que
    ela não pode: rota nova nasce fechada para ela (a `/sulamerica` da Fase D inclusive) e
    aberta para o admin. Ver "Controle de acesso por papel" nas decisões de implementação
    para as camadas.

18. **SulAmérica (Fase D, 17/09/2026).** Acesso exclusivo de admin, com papel confirmado
    no banco na página e nas actions. Prazo escolhido explicitamente entre 3, 6 e 12
    **meses de calendário**, sem opção pré-selecionada. O vencimento é calculado pelo
    Postgres, inclusive o ajuste para o último dia de mês, e nunca em TypeScript.
    Cadastro faz upsert por paciente_id dentro da transação que acha o paciente (desde
    29/10/2026 sem criar — regra 24).
    **Desde 28/10/2026 o cadastro mora na aba `/sulamerica/encaminhamentos`** (só admin),
    não mais no painel: nome do paciente, data do encaminhamento (**= `data_inicio`**: a
    autorização começa na data do encaminhamento), prazo (obrigatório, 3/6/12, sem
    pré-seleção), carteirinha e CRM (regra 20, mesmas regras da Klini) e **nome do médico
    (obrigatório no formulário**; 3 a 120 caracteres depois de normalizar espaços, ao menos
    uma letra, sem caractere de controle; acento, ponto, apóstrofo e hífen aceitos; caixa
    gravada como veio — `lib/domain/nome-medico.ts`). O painel `/sulamerica/dashboard`
    ficou com listagem, status, resumo, exclusão e o botão "Registrar Encaminhamento" (no
    cabeçalho da seção "Registradas", leva à aba nova). A view
    classifica os mesmos quatro casos mensais de Encaminhamentos; a lista ordena por
    urgência e depois lower(nome). Excluir na SulAmérica remove só a autorização.
    A exclusão completa de paciente no Klini continua completa: inclui sua autorização
    SulAmérica, caso exista, e a confirmação informa isso antes de exigir EXCLUIR.

19. **Situação da requisição (26/10/2026).** Toda requisição está `solicitada` (enviada
    ao convênio, em análise) ou `aprovada`. A situação é da **requisição** (a pasta
    numerada), não de cada guia: todas as guias do mesmo número compartilham a mesma.
    - Requisição nova nasce `solicitada`, gravada explicitamente por `criarRequisicao`.
      Acrescentar ou atualizar terapia numa requisição existente **não** muda a situação.
    - **Só o admin altera**, nos dois sentidos (aprovar e voltar para solicitada, para
      corrigir clique errado). Recepção vê, não altera. Marcar a situação que já está
      gravada não é erro.
    - Requisição `solicitada` **não aceita lançamento de atendimento novo**: o lote que
      contiver qualquer guia dela é recusado inteiro, citando o número da requisição.
      **Editar e excluir** atendimento que já existe continuam permitidos em qualquer
      situação, para não deixar histórico preso.
    - A situação é dado gravado, não calculado: **não** entra na view
      `requisicao_terapia_saldo` nem no `status_alerta`. Uma guia de requisição
      solicitada continua avaliada pelas mesmas regras de saldo e validade.

20. **Carteirinha e CRM no paciente (28/10/2026).** O número da carteirinha do convênio e
    o CRM do médico que encaminhou são dados **do paciente** (colunas
    `paciente.numero_carteirinha` e `paciente.crm_medico`), não do encaminhamento.
    - **CRM obrigatório em todo cadastro de encaminhamento** (Klini e, desde 28/10/2026,
      SulAmérica), junto de nome e data — cada encaminhamento pode vir de um médico
      diferente.
    - **Carteirinha obrigatória só enquanto o paciente não tem uma** (ajuste de
      28/10/2026). Paciente novo ou paciente existente sem carteirinha (legado): campo
      vazio é recusado — o legado com "Este paciente ainda não tem carteirinha
      cadastrada. Informe o número.". Paciente que já tem carteirinha: campo vazio (ou só
      espaço) **mantém** a gravada, sem tocar na coluna — vazio não é erro e não apaga;
      campo preenchido é validado e substitui, com a mesma recusa de carteirinha de outro
      paciente. Reenviar a própria carteirinha (até em outra caixa) não é conflito.
    - A decisão é tomada **dentro da transação**, lendo o paciente com `FOR NO KEY
      UPDATE` (o mesmo lock que o UPDATE da carteirinha já tomava). A gravação mora na
      mesma transação de sempre: busca do paciente já travada (`exigirPacienteDoConvenio`,
      desde 29/10/2026; antes, get-or-create) → leitura travada → decisão da carteirinha →
      carteirinha/CRM no paciente → upsert do encaminhamento. Desde a regra 24 não há
      mais "paciente novo" aqui: o paciente sempre vem do Cadastro, e o caso
      "Informe o número da carteirinha." vale para quem foi cadastrado e ainda não tem uma
      (com a frase "Este paciente ainda não tem carteirinha cadastrada. Informe o número.").
      **Reenviar atualiza** o CRM (e a carteirinha, se informada), sem duplicar paciente
      nem encaminhamento.
    - O formulário recebe por nome **só o booleano** "tem carteirinha" (nunca o número)
      e com ele marca o campo como "(opcional)"; o texto de apoio "Opcional se o
      paciente já tem carteirinha cadastrada." aparece sempre. É dica: quem decide é o
      servidor.
    - **NULL permitido na tabela**, de propósito: pacientes cadastrados antes de 28/10/2026
      não têm esses dados, e NULL é "não informado". Paciente antigo continua listando,
      com os dois campos nulos. Não há backfill nem `NOT NULL`.
    - **Formatos** (normalização no domínio, garantia no banco): carteirinha tem espaços
      removidos (pontas e meio) e depois precisa ter 5 a 25 letras ou dígitos ASCII —
      sem acento, hífen, ponto ou barra; a caixa é gravada como veio. CRM tem pontos e
      espaços removidos e depois precisa ter 1 a 10 dígitos — sem UF.
    - **Uma carteirinha pertence a um paciente só**, comparando sem caixa (`ABC123` e
      `abc123` são a mesma). Carteirinha de outro paciente é recusada com "Esta
      carteirinha já está cadastrada para <nome>.". O mesmo paciente reenviando a própria
      carteirinha (até em outra caixa) não é conflito.
    - **Carteirinha e CRM nunca vão para log, mensagem de erro, exceção não tratada,
      URL ou query string.**
    - **Onde aparecem (desde 28/10/2026):** só nas listas de `/klini/encaminhamentos` e
      `/sulamerica/encaminhamentos` (telas de admin), em colunas próprias, cada uma com o
      seu botão de copiar. O painel da SulAmérica não os recebe. O botão
      copia no navegador o valor que a página já recebeu — não existe rota que devolva
      esses números. Paciente sem o dado mostra "falta preencher" e o botão desabilitado.
    - **Limitação conhecida (28/10/2026) — deixou de acontecer em 29/10/2026.** Carteirinha e
      CRM são do paciente, não do convênio, e até a regra 24 um mesmo paciente podia ter
      encaminhamento nos dois convênios e compartilhar os dois campos. Desde a regra 24 um
      paciente é de **um** convênio só e a aba do outro o recusa sem tocar em nada; o
      teste de integração que fixava o compartilhamento passou a fixar a recusa. Paciente
      que já tinha os dois cadastros antes ficou com `convenio` NULL pela migration e é
      recusado nos dois encaminhamentos até alguém decidir o convênio dele (pendência).

21. **Paciente só nasce pelos dois cadastros de encaminhamento (28/10/2026).** ***Substituída
    pela regra 24 em 29/10/2026**: hoje só a aba Cadastro cria paciente e os dois
    encaminhamentos só acham paciente que já existe. O texto abaixo é o histórico; as
    partes que continuam valendo (busca em "Nova requisição", legado sem carteirinha não
    bloqueado, seed) estão repetidas na regra 24.* As
    **únicas** formas de criar paciente são o cadastro de encaminhamento da Klini
    (`/klini/encaminhamentos`: nome + data + carteirinha + CRM, regra 20,
    `encaminhamentos.ts`) e o da SulAmérica (`/sulamerica/encaminhamentos`: nome + data +
    prazo + carteirinha + CRM + nome do médico, regra 18, `autorizacoes-sulamerica.ts`).
    Os dois chamam `obterOuCriarPaciente` na mesma ordem de transação e de lock. "Nova
    requisição" só procura (regra 15) e recusa nome inexistente sem gravar nada. Nenhuma
    rota, action ou script cria paciente fora disso — afirmado por
    `lib/domain/pacientes-origem.test.ts`, que varre `app/`, `lib/`, `components/` e
    `scripts/`, **sem exceção temporária**.
    - **Fim do caminho temporário (28/10/2026).** Até esta data o formulário do painel
      `/sulamerica/dashboard` criava paciente com só nome + data + prazo, e era listado no
      teste de varredura como exceção temporária. O formulário saiu do painel; a mesma
      função de domínio (`registrarAutorizacao`) agora só é chamada pela action da aba
      Encaminhamentos, que exige carteirinha, CRM e médico. Um paciente criado só pela
      SulAmérica não tem encaminhamento Klini e cai na recusa da regra 15.
    - **Legado sem carteirinha/CRM não é bloqueado** (decisão deliberada): quem já tem
      encaminhamento recebe requisição mesmo com `numero_carteirinha`/`crm_medico` nulos.
      Bloquear pararia a operação da clínica até o preenchimento. Pendência: preencher
      carteirinha/CRM do legado.
    - **Sugestões**: o `datalist` de "Nova requisição" lista só quem tem encaminhamento
      (`listarNomesParaRequisicao`, em `pacientes.ts`). Os dois formulários de
      encaminhamento sugerem todos os pacientes (`listarPacientesParaEncaminhamento`, nome
      + booleano). `listarNomesDePacientes` saiu em 28/10/2026: o único uso era o
      formulário removido do painel SulAmérica. É sugestão; quem decide é a transação.
    - O seed de desenvolvimento (`prisma/seed.ts`) cria pacientes **fictícios** pelo
      Prisma, sem encaminhamento — fica, por ser só de desenvolvimento.
      `scripts/seed-terapias.ts` não toca em paciente.

22. **Substituir guias da mesma terapia (29/10/2026).** "Nova requisição" tem a caixinha
    **"Substituir guias da mesma terapia"**, **desmarcada por padrão** (apagar atendimento
    não tem volta; inverter o padrão é a constante `SUBSTITUIR_PADRAO` do formulário).
    - **Marcada**: para cada terapia do envio, as guias (`requisicao_terapia`) do **mesmo
      paciente** com a **mesma terapia** em requisições de **outro número** são apagadas,
      **com os atendimentos** (cascade), e a guia nova entra. Terapias que o paciente tem e
      que não vêm no envio ficam intactas. Ex.: 333 com Fono + TO; lançar 444 só com Fono,
      marcada → 333 fica só com TO, 444 com Fono.
    - Requisição antiga que fica **sem nenhuma guia** é apagada também (não sobra pasta
      vazia). A que ainda tem guia fica, com a situação que tinha.
    - Marcada sem terapia em comum: nada é apagado. **Desmarcada**: comportamento de antes,
      as guias coexistem.
    - Nunca toca em guia de outro paciente. A guia da **mesma requisição** (mesmo número)
      não é apagada: segue o UPDATE da regra 5, que tem prioridade.
    - Tudo na transação de `criarRequisicao` (atômico). Antes de gravar, o formulário pede a
      **prévia** (`previsaoDeSubstituicao`, só leitura) e, havendo o que apagar, mostra um
      diálogo com a lista (terapia, requisição, nº de atendimentos), "Cancelar" e
      "Substituir e apagar"; sem nada a apagar, grava direto. O servidor é a autoridade:
      refaz a consulta sob `FOR UPDATE` e apaga o que casar naquele momento.
    - Sucesso com substituição: "Requisição <n> lançada. Substituído: Fono (requisição 333,
      12 atendimentos apagados)." — com os números da transação, não da prévia.
    - Só admin (página, action da prévia e action de criar, papel lido do banco).
    - A requisição **nova** nasce `solicitada` (regra 19): depois de substituir, aquela
      terapia fica **sem guia lançável** até o admin aprovar — os atendimentos antigos já
      foram apagados e a guia nova recusa lançamento. Se o envio cair numa requisição que já
      existe (mesmo número), a situação dela não muda.

23. **Convênio do paciente, plano de terapias e Cadastro como porta de entrada (29/10/2026).**
    - **Convênio por paciente**: `paciente.convenio` é `klini`, `sulamerica` ou NULL ("ainda
      não decidido"). Um paciente pertence a um convênio só.
    - **Plano de terapias informativo**: por paciente, minutos por semana de cada terapia
      (`plano_terapia`). O formulário recebe horas ("2", "2,5", "2.5", "0,25") e o domínio
      converte para minutos inteiros (`lib/domain/tempo-semanal.ts`): maior que zero, até
      168 h, passo de 15 min. **Sem cálculo**: nenhum campo derivado, nenhuma soma, e nada
      no sistema lê o plano para decidir saldo, guia ou atendimento.
    - **Cadastro de paciente** (`cadastrarPaciente` em `lib/domain/plano-terapias.ts`):
      nome + convênio + ao menos uma terapia (sem repetir terapia na mesma entrada), numa
      transação. Paciente novo → nasce com o convênio e o plano. Existe com o **mesmo**
      convênio → o plano é **substituído inteiro** (DELETE + INSERT das linhas do plano; o
      nome gravado não muda). Existe com convênio **NULL** → adota o convênio e grava o
      plano. Existe com o **outro** convênio → "Este paciente já está cadastrado no outro
      convênio.", nada gravado. Nome casado pelo get-or-create de sempre (trim,
      `lower(nome)`).
    - **Porta de entrada — concluída em 29/10/2026 (regra 24).** O cadastro é a **única**
      forma de criar paciente, pela aba **Cadastro** de cada convênio (`/klini/pacientes`,
      `/sulamerica/pacientes`, só admin). A action `cadastrarPacienteAction` autoriza pela
      rota da aba Cadastro do convênio do envio, e o convênio gravado é o da página.
    - Preenchimento dos pacientes que já existiam (migration
      `20261029120000_convenio_e_plano_de_terapias`): com encaminhamento → `klini`; com
      autorização SulAmérica → `sulamerica`; com os dois ou nenhum → NULL.

24. **Cadastro é a única porta de entrada; encaminhamento só de paciente existente
    (29/10/2026).** Substitui a regra 21.
    - **Aba Cadastro** em cada convênio (`/klini/pacientes`, `/sulamerica/pacientes`, item
      "Cadastro" no menu do convênio, antes de "Encaminhamentos"). Só admin: proxy,
      `requireAcessoARota` na página, `autorizarRota` na action, menu. O convênio da
      página é o convênio gravado.
    - **Formulário**: nome do paciente + linhas "terapia + tempo por semana (horas)"
      (catálogo de `listarTerapias`; "Adicionar terapia", "Remover"; texto de apoio
      "Digite em horas, por exemplo 2 ou 2,5."). Na tela a terapia já escolhida em outra
      linha fica desabilitada; o servidor continua recusando a repetida. "Cadastrar
      paciente" → sucesso limpa, volta o foco ao nome e mostra "Paciente cadastrado." ou
      "Plano atualizado." (paciente que já existia no convênio, ou que adotou o convênio).
    - **Lista** abaixo: pacientes do convênio da aba em ordem de nome, com o plano em uma
      linha ("Fono 2 h · TO 1 h 30 min") ou "Plano não cadastrado" (paciente antigo),
      busca por nome (mesma do painel) e "Editar". "Editar" carrega o paciente no
      formulário com o **nome travado** (o paciente é casado pelo nome) e o envio
      substitui o plano inteiro. Só nome e plano: a tela Cadastro não recebe carteirinha
      nem CRM. Paciente com `convenio` NULL não aparece em nenhuma das duas listas;
      digitar o nome dele no Cadastro o faz adotar o convênio da aba.
    - **Encaminhamentos (Klini e SulAmérica) só de paciente já cadastrado naquele
      convênio** (`exigirPacienteDoConvenio` em `pacientes.ts`, no lugar do get-or-create,
      com a mesma trava `FOR NO KEY UPDATE` que a carteirinha já tomava). O `datalist` traz
      só os pacientes do convênio. Recusas, sem gravar nada:
      - nome de ninguém → "Paciente não cadastrado. Cadastre primeiro em Cadastro.", com
        link "Ir para Cadastro" para a aba do convênio;
      - paciente do outro convênio → "Este paciente está cadastrado no outro convênio.
        Registre o encaminhamento na aba Encaminhamentos do convênio dele.";
      - paciente com `convenio` NULL → "Este paciente ainda não tem convênio definido.
        Cadastre-o primeiro em Cadastro, com o plano de terapias.", com o mesmo link.
    - **O resto dos encaminhamentos não mudou**: carteirinha opcional quando o paciente já
      tem uma (`decidirCarteirinha`), CRM sempre obrigatório, prazo e nome do médico na
      SulAmérica, unicidade da carteirinha, botões de copiar, upsert (substituição) do
      encaminhamento, "Excluir" (paciente inteiro) da Klini. "Nova requisição" continua
      exigindo paciente com encaminhamento (regra 15), sem criar.
    - **Legado sem carteirinha/CRM não é bloqueado** na requisição (decisão da regra 21,
      mantida). O seed de desenvolvimento (`prisma/seed.ts`) continua criando pacientes
      fictícios pelo Prisma, fora da varredura.
    - Afirmado por `lib/domain/pacientes-origem.test.ts`: o get-or-create só é chamado por
      `plano-terapias.ts` (uma vez, na transação do cadastro); `cadastrarPaciente` só pela
      action; a action só pela tela Cadastro; os dois encaminhamentos só chamam
      `exigirPacienteDoConvenio`. Sem exceção temporária.

## Decisões assumidas (perguntas em aberto no relatório de auditoria original)

- `paciente.nome`: único case-insensitive no banco.
- `numero_requisicao`: único por paciente, não globalmente. Repetir o número de um
  paciente **não é erro**: acrescenta terapias à requisição que já existe (regra 5). O
  índice único continua no banco — ver "Número repetido acrescenta em vez de recusar" nas
  decisões de implementação.
- `qtd_autorizada`: deve ser > 0 na criação da guia (e na atualização pela terapia
  repetida, que passa pela mesma validação).
- `(requisicao_id, terapia_id)`: único. Repetir a terapia na mesma requisição **atualiza**
  a guia (regra 5). ~~Mesma terapia repetida = segunda guia~~ — revertido em 26/10/2026.
- ~~Exclusão de guia `"Regular"` bloqueada no backend.~~ Revertida — ver regra 9.
- Edição de atendimento para 0 créditos continua permitida.

## Decisões tomadas durante a implementação (não estavam no relatório original)

- **Aba Cadastro e encaminhamento só de paciente existente (29/10/2026, branch
  `feat/cadastro-plano-ui`, a partir de `feat/cadastro-plano-dominio` em `92ec032`; sem
  commit, sem merge, sem push).** Regra 24. Nenhuma migration.
  - **Rotas**: `ROTA_KLINI_PACIENTES` e `ROTA_SULAMERICA_PACIENTES` em `lib/auth/acesso.ts`
    (fora do allowlist da recepção, então fechadas para ela no proxy, na página e na
    action sem mais nada). `cadastrarPacienteAction` passou a autorizar por essas rotas
    (antes, pelas de Encaminhamentos).
  - **Busca no lugar do get-or-create**: `exigirPacienteDoConvenio(tx, nome, convenio)` em
    `pacientes.ts` — `SELECT ... FOR NO KEY UPDATE` por `lower(nome)`, a trava que
    `situacaoDaCarteirinha` já tomava, agora tomada já na busca porque o convênio decide o
    desfecho. Serializa com o Cadastro (mesmo lock) e com a exclusão (`FOR UPDATE`); não
    conflita com o `FOR KEY SHARE` da requisição. Ordem de lock inalterada (paciente →
    filho). `gravarCarteirinhaECrmNaTransacao` recebe só `{ id }` (o `criado` morreu: não
    há mais paciente novo aqui), e `pacienteCriado` saiu de `ResultadoGravacao` dos dois
    encaminhamentos — ficaria sempre `false`.
  - **Mensagens** em `pacientes-mensagens.ts` (puro, o formulário importa):
    `ERRO_PACIENTE_FORA_DO_CADASTRO` (o nome `ERRO_PACIENTE_NAO_CADASTRADO` já existe em
    `requisicoes-mensagens.ts`, com outra frase), `ERRO_PACIENTE_DE_OUTRO_CONVENIO`,
    `ERRO_PACIENTE_SEM_CONVENIO`, `ehErroQueLevaAoCadastro` (decide o link) e
    `ehErroDoPacienteDoEncaminhamento` (marca o campo do nome). O link é
    `components/aviso-de-erro-do-encaminhamento.tsx`, usado pelos dois formulários.
  - **Formulários de encaminhamento**: nome fora do `datalist` não passa pela checagem
    local da carteirinha — senão "Informe o número da carteirinha." esconderia a recusa
    certa do servidor. O CRM continua checado no cliente (o servidor também o valida
    antes da busca, então a ordem das mensagens é a mesma dos dois lados).
  - **Tela Cadastro** em `components/cadastro-de-paciente/` (`tela-de-cadastro.tsx`, que
    junta formulário e lista porque o "Editar" carrega o paciente no formulário;
    `lista-de-pacientes.tsx`; `resumo-do-plano.ts`; `cabecalho-do-cadastro.tsx`). Páginas
    finas em `app/(app)/{klini,sulamerica}/pacientes/page.tsx`. Decisões próprias: em
    edição o botão diz **"Salvar plano"** (e há "Cancelar edição"), em vez de "Cadastrar
    paciente"; em modo de cadastro, digitar o nome de quem já está na lista mostra o
    aviso "Cadastrar de novo substitui o plano dele." (o domínio casa pelo nome); a toast
    usa `mensagemDeCadastro` (com o nome) e a linha de status, as frases curtas pedidas;
    "Adicionar terapia" desabilita quando todas as terapias do catálogo já estão em
    alguma linha; "Remover" desabilita na última linha. O Cadastro **não** tem `datalist`
    (sugerir nomes existentes convidaria a substituir plano sem querer). Minutos voltam a
    texto de horas por `minutosParaHorasDigitadas` (`tempo-semanal.ts`, inverso exato de
    `lerHorasSemanais`, testado para todos os múltiplos de 15 até 168 h).
  - **Testes** (710 em 43 arquivos; eram 673 em 40): preparo comum
    `test/paciente-cadastrado.ts` (fora das pastas varridas por `pacientes-origem.test.ts`;
    cadastra pelo próprio `cadastrarPacienteNaTransacao`, reaproveitando a primeira
    terapia do catálogo para os preparos commitados não deixarem terapia órfã);
    `cadastro-e-encaminhamento.integration.test.ts` (fluxos Klini e SulAmérica Cadastro →
    Encaminhamento, recusa cruzada, Editar substitui, NULL adota e passa a receber
    encaminhamento, a linha da tela Cadastro só com `pacienteId/pacienteNome/plano/
    temPlano`, `registrarEncaminhamento` de produção sem criar nada);
    `app/(app)/klini/pacientes/acesso-da-recepcao.test.ts` (as duas páginas e a action,
    papel do banco com cookie dizendo admin; para o admin, a página lê só o convênio dela
    e grava esse convênio no campo escondido); `resumo-do-plano.test.ts`. Mutações
    conferidas: sem `requireAcessoARota` na página, sem `autorizarRota` na action, sem a
    recusa de outro convênio e sem a recusa de NULL, testes caem.
  - **Testes antigos alterados** (nenhum afrouxado): os de integração que criavam paciente
    pelo encaminhamento passam a cadastrá-lo antes; "cria o paciente quando ele ainda não
    existe" virou "nome que não é de ninguém é recusado e NÃO cria paciente"; os "paciente
    novo sem carteirinha" viraram "nome não cadastrado é recusado"; o que fixava o
    "limite conhecido" (paciente Klini compartilhando carteirinha/CRM na SulAmérica) agora
    fixa a recusa por outro convênio; os de transação de produção da SulAmérica ("o
    paciente recém-criado some") agora conferem que o paciente cadastrado não recebeu
    nada; asserções de `pacienteCriado` nos encaminhamentos saíram; o fluxo completo de
    `requisicoes.integration.test.ts` virou Cadastro → Encaminhamento → Nova requisição;
    `pacientes-origem.test.ts` com a lista nova; menu com "Cadastro" nos dois convênios;
    `acesso.test.ts` e `proxy.test.ts` com as rotas novas. No teste da corrida da
    carteirinha (`carteirinha-crm.integration.test.ts`), o dublê passou a cegar a
    checagem de dono e não a leitura de `situacaoDaCarteirinha` (as duas têm "IS NOT
    NULL" no SQL): cegando a errada, o teste passava pela checagem prévia sem chegar ao
    índice único que diz testar.
  - **Não testado**: a tela no navegador (clique, foco, `scrollIntoView` do Editar,
    opção desabilitada no `select`, layout no celular) — roteiro em pendências; corrida
    real entre um Cadastro adotando convênio e um encaminhamento do mesmo paciente (o
    lock é o mesmo, sem teste com portão); as Server Actions por HTTP; o Supabase.

- **Convênio, plano de terapias e cadastro de paciente — banco e domínio (29/10/2026,
  branch `feat/cadastro-plano-dominio`, a partir da `main` em `eecec84`; sem commit, sem
  merge, sem push).** Regra 23. Só banco e domínio: nenhuma tela, e os fluxos de
  encaminhamento **não** mudaram (P2).
  - **Migration `20261029120000_convenio_e_plano_de_terapias`, aditiva**: `paciente.convenio
    TEXT` NULL + CHECK `paciente_convenio_valido`; o preenchimento (um `UPDATE` com
    `EXISTS(encaminhamento) <> EXISTS(autorizacao)`, só onde `convenio IS NULL`) entre os
    marcadores `-- inicio/fim: preenchimento do convenio`, que o teste lê do disco; e a
    tabela `plano_terapia`. No banco local saíram 2 `klini`, 1 `sulamerica` e 2 NULL (sem
    nenhum dos dois); **nenhum paciente com os dois**. Schema: `convenio String?` e o
    model `PlanoTerapia` (`@@unique([pacienteId, terapiaId])`, `onDelete: Cascade` no
    paciente). Depois de aplicada, `migrate dev --create-only` gerou migration vazia
    (apagada), `migrate diff --from-config-datasource --to-schema` vazio e `db pull
    --print` igual ao schema.
  - **Sem colunas de auditoria**: o pedido falava em "colunas de auditoria no mesmo padrão
    das outras tabelas", mas nenhuma tabela do projeto tem (`criado_em` etc.). Seguido o
    padrão real: nenhuma. Se for para ter, é decisão para todas as tabelas.
  - **Sem índice separado em `paciente_id`**: a UNIQUE `(paciente_id, terapia_id)` começa
    por ele e serve às mesmas buscas (mesmo raciocínio das migrations de
    `encaminhamento` e `requisicao_terapia`). Não há índice em `terapia_id` (só a FK
    RESTRICT; nenhuma tela apaga terapia).
  - **GRANTs**: nenhuma migration do projeto tem GRANT (regra "Não colocar configuração
    específica do Supabase em `prisma/migrations`"). No local, `ALTER DEFAULT PRIVILEGES`
    do `postgres` já dá `arwd` em tabela e `rU` em sequência ao `vigia_klini` —
    conferido em `plano_terapia` e `plano_terapia_id_seq` depois de aplicar. No Supabase
    **não foi conferido** (ver pendências).
  - **Módulos**: `plano-terapias.ts` (banco), `plano-terapias-actions.ts`,
    `plano-terapias-mensagens.ts`, e dois puros a mais, sem banco, para o formulário do
    P3 poder importar: `convenio.ts` (`CONVENIOS`, espelho do CHECK) e
    `tempo-semanal.ts` (`lerHorasSemanais`, `formatarMinutosSemanais`; conta com
    inteiros, sem ponto flutuante). `listarTerapias` é reexportada de `requisicoes.ts`
    (mesmo catálogo).
  - **Ordem de lock** de `cadastrarPaciente`: `obterOuCriarPaciente` → `SELECT convenio
    ... FOR NO KEY UPDATE` no paciente (decide o desfecho; serializa dois cadastros do
    mesmo paciente; não bloqueia o `FOR KEY SHARE` da requisição) → `UPDATE convenio` se
    NULL → terapias `FOR KEY SHARE` (recusa de terapia inexistente vira frase com a linha,
    não erro de FK) → `DELETE` do plano → `createMany`. Direção paciente → filhos, a mesma
    da exclusão (paciente `FOR UPDATE` → … → plano pelo cascade). Paciente apagado entre o
    get-or-create e a trava → `ERRO_PACIENTE_EXCLUIDO_AGORA`. Erros de negócio são
    `throw` (desfazem o paciente recém-criado); `cadastrarPacienteNaTransacao` é a
    variante de teste.
  - **Leituras**: `listarPacientesDoConvenio(convenio)` (id, nome, `plano` em ordem de
    nome da terapia via `json_agg`, `temPlano`), `planoDoPaciente(id)` e
    `listarTerapias()`; cada uma com a variante `ComCliente` para o teste.
  - **Exclusão permanente**: `excluirPacienteNaTransacao` não mudou; o `DELETE` do
    paciente leva o plano pelo cascade (teste de integração). A contagem do diálogo não
    cita o plano.
  - **Testes** (673 em 40 arquivos; eram 582 em 38): `plano-terapias.test.ts` (tempo
    semanal — 0,25 ok, 0,1 recusa, 168 ok, 168,25 recusa, vírgula/ponto, texto, sinal,
    mensagens sem o valor digitado —, formatação, convênio, `validarEntrada`);
    `plano-terapias.integration.test.ts` (novo com plano; reenvio substitui sem duplicar,
    com caixa/espaço diferentes; adota NULL; outro convênio recusado; repetida e vazia
    sem criar paciente; terapia inexistente; CHECK recusando 0, 10, -15, 10081 e 10095 e
    aceitando 15 e 10080; UNIQUE; CHECK do convênio; exclusão leva o plano; leituras;
    preenchimento da migration sobre tabelas temporárias de mesmo nome; e dois testes
    **commitados**: recusa pela `cadastrarPaciente` de produção e `Proxy` que estoura o
    `createMany` depois do paciente criado — nos dois o paciente não sobra);
    `acesso-por-papel.test.ts` (recepção recusada nos dois convênios e num inválido;
    admin chega ao domínio); `pacientes-origem.test.ts` (`plano-terapias.ts` na lista do
    get-or-create; só a action chama `cadastrarPaciente`). Mutações conferidas: sem a
    checagem de outro convênio e sem o DELETE da substituição, o teste correspondente cai.
  - **Não testado**: corrida de dois cadastros simultâneos do mesmo paciente (o lock é o
    mesmo já testado nos encaminhamentos, mas não há teste com portão aqui); a Server
    Action por HTTP; o Supabase.

- **Substituir guias da mesma terapia (29/10/2026, branch `feat/substituir-requisicao`, a
  partir da `main` em `d61a8be`; sem commit, sem merge, sem push).** Regra 22. Nenhuma
  migration.
  - **FK conferida**: `atendimento_requisicao_terapia_id_fkey` é `ON DELETE CASCADE`
    (migration `20260828120000_init`); `requisicao_terapia → requisicao` é `RESTRICT`. Por
    isso a guia é apagada antes da requisição, e os atendimentos não têm DELETE próprio.
  - **Reuso**: cada guia sai por `excluirGuiaNaTransacao` (`guias.ts`), a mesma exclusão do
    painel; não há DELETE novo de guia. O DELETE novo é só o da requisição vazia.
  - **Ordem de lock** (documentada no topo de `atendimentos.ts`): paciente `FOR KEY SHARE`
    (`buscarPacientePorNome`, já existia) → `SELECT ... FOR UPDATE OF rt` nas guias alvo,
    `ORDER BY id` → contagem de atendimentos (comando novo, enxerga o que um lançamento
    concorrente commitou) → `excluirGuiaNaTransacao` em ordem de id → `FOR UPDATE` nas
    requisições antigas, por id → `DELETE ... WHERE NOT EXISTS (guia)` num comando novo
    (um cadastro que acabou de pendurar guia na pasta antiga é visto e a pasta fica). A
    substituição roda depois da checagem de terapias e antes de qualquer INSERT.
  - **Prévia e transação usam a mesma consulta** (`guiasDaSubstituicao`), a prévia sem
    lock e sem filtro de ids. Paciente inexistente na prévia → lista vazia (o envio segue
    e a recusa vem da criação).
  - **Assinatura**: `previsaoDeSubstituicao(pacienteNome, terapiaIds, numeroRequisicao)` —
    o número entrou porque a guia da requisição de mesmo número não é apagada, e sem ele a
    prévia diria mais do que a transação apaga. `substituir` é opcional em
    `EntradaNovaRequisicao` (ausente = `false`), para os chamadores antigos continuarem no
    caminho que não apaga nada. A action só liga com o valor exato `"sim"`.
  - **Resultado**: `ResultadoCriacao` ganhou `substituidas` (guias apagadas, com terapia,
    número e atendimentos) e `requisicoesApagadas`. A action repassa ao cliente só os
    campos de texto. Requisição antiga apagada aparece na descrição do toast.
  - **Formulário**: seção "3. Guias antigas" com checkbox nativo (rótulo visível, texto de
    apoio por `aria-describedby`, sem cor nova). Com a caixinha marcada, o submit é
    interceptado, a prévia roda ("Verificando..." no botão) e o `AlertDialog` lista o que
    será apagado; "Substituir e apagar" reenvia o formulário por `requestSubmit` com uma
    trava de um uso, "Cancelar"/Esc não envia nada. O botão de confirmar usa o carmim já
    existente (como em "Excluir tudo"). Depois do sucesso a caixinha volta a desmarcada.
  - **Testes** (582 em 38 arquivos; eram 557 em 37): `requisicoes-substituicao.integration.test.ts`
    (marcada apaga guia + atendimentos e preserva TO; pasta vazia some e a mista fica; sem
    terapia em comum; desmarcada; outro paciente; mesmo número atualiza e só a de outro
    número sai; prévia = transação e não escreve; prévia de nome inexistente; saldo limpo
    na view; atomicidade com cenário commitado e `Proxy` que faz o `requisicao.create`
    estourar **depois** do DELETE da guia; duas corridas com portão e `pg_stat_activity`).
    Unitários: checkbox só com `"sim"` consulta a substituição; mensagens. Papel: recepção
    recusada na prévia e na criação com a caixinha. Mutações conferidas (cada uma derruba
    um teste): sem checagem de papel na prévia; sem `FOR UPDATE OF rt` (a contagem fica
    velha na corrida); sem filtro de número; sem filtro de paciente; sem DELETE da pasta
    vazia.
  - **Limitações conhecidas**: a contagem de atendimentos é feita sob o lock da guia, mas
    a exclusão de atendimento não trava a guia — uma exclusão simultânea pode tornar o
    número citado 1 maior que o apagado. Um cadastro concorrente acrescentando terapia
    **na pasta antiga** que chegue depois do `FOR UPDATE` da requisição espera e, se a pasta
    for apagada, falha com erro de FK cru (raro: exige o mesmo paciente e número antigo ao
    mesmo tempo).

- **Encaminhamentos da SulAmérica (28/10/2026, branch `feat/sulamerica-encaminhamentos`, a
  partir de `feat/paciente-so-por-encaminhamento` em `168a848`; sem commit, sem merge, sem
  push).** Regras 18, 20 e 21.
  - **Migration `20261028140000_nome_do_medico_sulamerica`**: `nome_medico TEXT NULL` +
    CHECK `autorizacao_sulamerica_nome_medico_tamanho` (`char_length(btrim(...))` entre 3 e
    120). Schema: `nomeMedico String? @map("nome_medico")`. Depois de aplicada, `migrate dev
    --create-only` gerou migration vazia (apagada) e `db pull --print` bate com o schema.
    A view `autorizacao_sulamerica_status` **não** foi recriada: a listagem faz `JOIN` na
    tabela para ler `nome_medico` (menos DDL numa migration de produção).
  - **Antes, o painel** tinha um formulário inline (nome com `datalist` de todos os
    pacientes, data de início padrão hoje, prazo 3/6/12 sem pré-seleção) que chamava
    `criarAutorizacaoAction` → `registrarAutorizacao`: get-or-create do paciente, `FOR
    UPDATE` na linha do paciente e upsert da autorização. Criava paciente só com o nome, sem
    carteirinha nem CRM. Saíram: `formulario-de-autorizacao.tsx` (`git rm`),
    `criarAutorizacaoAction`/`EstadoNovaAutorizacao` e `listarNomesDePacientes` (único uso).
  - **Extraído para `lib/domain/carteirinha-crm-gravacao.ts`** (movido de
    `encaminhamentos.ts`, não copiado): `ErroDeNegocio`, checagem de dono, `SAVEPOINT`,
    saneamento de erro, `situacaoDaCarteirinha` e a nova `gravarCarteirinhaECrmNaTransacao`
    (situação travada → `decidirCarteirinha` → gravação). Klini e SulAmérica chamam a mesma.
    No cliente, `components/usar-situacao-da-carteirinha.ts` (`useSituacaoDaCarteirinha`) e
    `components/campos-carteirinha-crm.tsx` (`CampoDeCarteirinha`, `CampoDeCrm`) saíram do
    formulário da Klini, com o mesmo HTML, para os dois formulários terem rótulo,
    "(opcional)" e texto de apoio iguais.
  - **Ordem de lock da SulAmérica agora é a da Klini**: get-or-create → paciente `FOR NO KEY
    UPDATE` (na leitura da situação da carteirinha) → `SELECT ... FROM
    autorizacao_sulamerica ... FOR UPDATE` → upsert com `nome_medico`. O `FOR UPDATE` que
    havia na linha do paciente saiu: o `FOR NO KEY UPDATE` já serializa dois cadastros do
    mesmo paciente e, ao contrário dele, não bloqueia o `FOR KEY SHARE` de uma requisição.
    Recusa (carteirinha, dono) é `throw` de `ErroDeNegocio` e desfaz o paciente recém-criado;
    `registrarAutorizacaoNaTransacao` (teste) devolve `{ ok: false }` sem desfazer, como na
    Klini. O nome do médico é validado em `validarEntrada`, antes da transação. O erro
    inesperado do upsert é saneado (sem `cause`), como o do UPDATE da carteirinha.
  - **Duas leituras**: `listarEncaminhamentosSulamerica()` (com carteirinha, CRM e médico,
    só para a página da aba) e `listarAutorizacoes()` (painel), que monta a linha sem esses
    três campos — o painel não passa a carregar os números no payload.
  - **Rota e acesso**: `ROTA_SULAMERICA_ENCAMINHAMENTOS` em `lib/auth/acesso.ts`. O
    allowlist da recepção já fechava todo `/sulamerica`, então o `proxy.ts` não mudou; a
    página usa `requireAcessoARota` e a action `autorizarRota` com a rota nova. Menu da
    SulAmérica: "Painel" e "Encaminhamentos". "Trocar convênio" nas duas páginas.
  - **Formulário**: duas faixas com `sm:items-start` (seis campos e o botão não cabem numa
    linha nem em `lg`, a página é `max-w-5xl`): nome/data/prazo (entre `sm` e `lg` o nome
    ocupa a linha, como na Klini) e carteirinha/CRM/médico/botão (o médico cresce). Mensagens
    da SulAmérica: "Informe uma data de encaminhamento válida." (era "de início") e
    "Encaminhamento cadastrado/atualizado para X." (era "Autorização ...").
  - **Lista**: colunas Paciente, Data do encaminhamento (é `data_inicio`; o rótulo do
    painel continua "Data de início"), Prazo, Vencimento, Situação (`SeloDeVencimento`),
    Carteirinha e CRM (`ValorCopiavel` da Klini) e Médico (só texto). Sem coluna de ações
    (a exclusão continua no painel). Tabela a partir de `lg` com `overflow-x-auto`, blocos
    abaixo. Dica de "falta preencher" pede mesmo nome **e mesma data e prazo**.
  - **Testes** (555 em 36 arquivos; eram 476 em 33). Alterados: `autorizacoes-sulamerica`
    unitário e integração (a entrada ganhou carteirinha/CRM/médico — o helper `registrar`
    passou a mandar os três; os testes de vencimento, upsert, exclusão, CHECK de prazo,
    coluna gerada, FK e view continuam iguais), `acesso-por-papel.test.ts`
    (`criarAutorizacaoAction` → `criarEncaminhamentoSulamericaAction`, com os campos novos),
    `itens-de-navegacao.test.ts` (admin vê dois itens SulAmérica; menus não se cruzam),
    `acesso.test.ts` e `proxy.test.ts` (rota nova restrita), `pacientes-origem.test.ts`
    (sem exceção temporária; só a action da aba chama `registrarAutorizacao`). Novos:
    `nome-medico.test.ts`; integração de paciente novo com os seis campos, reenvio, branco
    mantendo, legado/novo recusados, médico inválido, CHECK do `nome_medico`, carteirinha
    da Klini recusada com o nome do dono, paciente nos dois convênios, legado listando,
    erro saneado, e três recusas pela transação **de produção** (`registrarAutorizacao`,
    com `finally` de limpeza) mostrando que o paciente novo não sobra;
    `app/(app)/sulamerica/encaminhamentos/acesso-da-recepcao.test.ts` e
    `lista-de-encaminhamentos-sulamerica.test.ts`. Mutação conferida: sem a checagem de
    papel na página e na action, dois testes da recepção caem; sem o saneamento, o do erro
    cai.
  - **Não testado**: navegador (clique, cópia, foco, layout, celular) — roteiro nas
    pendências.
  - **Botão no painel (ajuste do mesmo dia)**: o link de texto "Cadastrar encaminhamento"
    no parágrafo de apresentação era difícil de ver e virou o botão "Registrar
    Encaminhamento" — `Button` variante padrão com `asChild` sobre o `Link` do Next (é um
    `<a>`, não `<button>` com `onClick`), ícone `Plus` antes do texto, `h-10` (40px), à
    direita do cabeçalho "Registradas"; abaixo de `sm`, linha própria em `w-full`. Ficou no
    cabeçalho da seção, e não na linha da busca, porque esta mora dentro de
    `ListaDeAutorizacoes`, que não foi tocada. Teste:
    `app/(app)/sulamerica/dashboard/botao-registrar-encaminhamento.test.ts`.

- **Paciente só pelo encaminhamento (28/10/2026, branch
  `feat/paciente-so-por-encaminhamento`, a partir de `feat/carteirinha-crm-klini-ui` em
  `b922691`; sem commit, sem merge, sem push).** Regras 15 (reforçada) e 21.
  - **Chamadores de `obterOuCriarPaciente` antes:** `encaminhamentos.ts` (Klini),
    `autorizacoes-sulamerica.ts` (SulAmérica), `requisicoes.ts` (Nova requisição) e
    `requisicoes.integration.test.ts` (preparo de um teste). **Depois:** só os dois
    primeiros. `requisicoes.ts` passou a `buscarPacientePorNome`; o teste insere o
    paciente direto com `tx.paciente.create` (fixture sintética, não caminho de produto).
    `prisma/seed.ts` tem um get-or-create próprio para os pacientes fictícios do seed.
  - **`buscarPacientePorNome(tx, nome)`** em `pacientes.ts`, ao lado do get-or-create e
    com a mesma expressão de comparação. Devolve `{ id, nome }` ou `null`, com
    `FOR KEY SHARE`. Por que travar: sem lock, uma exclusão de paciente commitando entre a
    checagem e o INSERT faria o INSERT estourar na FK (erro cru). O lock é o que o INSERT
    já pediria, adiantado; ordem paciente → filhos, a mesma da exclusão, então não há
    ciclo novo. No ramo "acrescenta à requisição existente" isto é lock **novo** na linha
    do paciente (antes esse ramo só travava guias/requisição) — compatível com tudo,
    exceto o `FOR UPDATE` da exclusão, que é o objetivo.
  - **Mensagem nova** `ERRO_PACIENTE_NAO_CADASTRADO` em `requisicoes-mensagens.ts`. Não
    repete o nome digitado nem sugere parecidos. As duas recusas (não cadastrado / sem
    encaminhamento) dizem, a quem é admin, se aquele nome existe como paciente — é o que
    foi pedido, e a tela é só de admin.
  - **`pacienteCriado` saiu de `ResultadoCriacao`** (só de requisição; encaminhamento e
    SulAmérica mantêm o deles). Nenhum consumidor lia.
  - **Formulário**: o erro de paciente (obrigatório, não cadastrado, sem encaminhamento)
    aparece logo abaixo do campo, com `aria-invalid` e `aria-describedby`, em vez de no
    fim do formulário; os demais erros continuam no fim. O texto de apoio da seção 1
    trocou "Se o paciente ainda não existe, ele é criado junto" por "Só pacientes com
    encaminhamento cadastrado", com link sublinhado "Cadastrar encaminhamento" para
    `/klini/encaminhamentos` (cor do texto de apoio; sem cor nova). O cliente **não**
    pré-valida o nome contra a lista: ela pode estar velha e não distingue os dois casos
    de recusa; quem decide é o servidor.
  - **Testes** (476 em 33 arquivos; eram 467): unitários de `requisicoes.test.ts` — o
    dublê do banco agora responde à busca (`FOR KEY SHARE`) e **falha** se receber
    `INSERT`; novos: nome inexistente sem escrita e sem consultar
    encaminhamento/número, mensagem sem o nome digitado, SQL da busca com lock e sem
    INSERT. Integração em rollback: nome inexistente com contagem da tabela `paciente`
    inteira antes/depois numa transação `RepeatableRead` (para não enxergar o que outros
    arquivos commitam em paralelo); caixa e espaços diferentes sem duplicar; legado sem
    carteirinha/CRM com encaminhamento aceito; lista só com quem tem encaminhamento; fluxo
    encaminhamento → requisição com contagem 0 → 1 → 1. `pacientes-origem.test.ts`
    varre o código. Mutação conferida: com o `requisicoes.ts` antigo (get-or-create), os
    dois testes de nome inexistente caem.

- **Carteirinha e CRM na tela de Encaminhamentos (28/10/2026, branch
  `feat/carteirinha-crm-klini-ui`, a partir de `feat/carteirinha-crm-dominio` em
  `bc6f168`; sem commit, sem merge, sem push).** Só apresentação: nenhuma regra, consulta,
  action ou migration mudou.
  - **Botão de copiar subiu para `components/`** — movido com `git mv`, não copiado:
    `components/botao-de-copiar.tsx` e `components/usar-copia.ts` (antes em
    `app/(app)/klini/dashboard/`). O botão ficou genérico (`texto`, `rotuloAcessivel`,
    `aviso`, `rotulo` opcional, `disabled`, `size`); o painel passa
    `textoDeCopia(...)` e o mesmo `aria-label` de antes e continua só-ícone, com o mesmo
    anúncio "Copiado: <texto>". `barra-de-selecao.tsx` importa o hook do lugar novo.
  - **Plano B da cópia** em `components/area-de-transferencia.ts`
    (`escreverNaAreaDeTransferencia`, sem React, ambiente por parâmetro para testar em
    `node`): `navigator.clipboard.writeText`; se não existir (http por IP na rede) ou for
    recusado, `execCommand("copy")` num `textarea` temporário; se os dois falharem, toast
    "Não foi possível copiar. Selecione o texto e copie manualmente." — **sem** repetir o
    valor. Vale também para o painel, que antes só mostrava o toast sem tentar o plano B.
  - **Lista**: colunas "Carteirinha" e "CRM" (`valor-copiavel.tsx`) entre "Situação" e
    "Ações". Número e, colado nele (`gap-x-1`), botão **só com ícone** (mesma variante do
    painel, sem `rotulo`), 36×36px (`icon-lg`) na tabela e nos blocos; nos blocos do
    celular o número vem precedido de "Carteirinha:" / "CRM:". `aria-label` e `title`
    (prop opcional nova do botão, que o painel não usa) sempre "Copiar carteirinha de
    <nome>" / "Copiar CRM de <nome>"; ao copiar, o ícone vira `Check` por 2s e a região
    `aria-live="polite"` anuncia "Carteirinha de <nome> copiada." (não o número). Copia
    `valor.trim()`, nada mais. (A primeira versão tinha texto "Copiar" visível ao lado do
    ícone; tirado a pedido no mesmo dia. A variante com `rotulo` continua no componente,
    sem uso.)
  - **Falta preencher**: "—" (`aria-hidden`) + "falta preencher" em texto, botão
    desabilitado; cada campo decide sozinho. Uma dica única acima da lista (só quando
    alguém está incompleto, contada sobre a lista inteira e não sobre o filtro) explica
    que basta registrar de novo com o mesmo nome **e a mesma data** — o reenvio é upsert e
    trocaria a data e o vencimento se a data mudasse —, e que para esses pacientes a
    carteirinha é obrigatória. Sem selo e sem cor nova: é ausência de dado, não status.
  - **Responsivo**: com sete colunas a tabela só aparece a partir de `lg` (antes `sm`);
    abaixo disso, blocos. A tabela fica dentro de um `overflow-x-auto` próprio, por
    garantia — a página não rola de lado. Larguras fixas das colunas de data e situação
    saíram (cabeçalho `whitespace-nowrap`).
  - **Formulário**: ordem passou a nome → data → carteirinha → CRM. Corrigido um estouro
    herdado da branch anterior: entre `sm` e `lg` quatro campos de largura fixa e o botão
    não cabiam numa linha (~714px em ~590px). Agora a linha é `sm:flex-wrap` com o nome em
    `sm:basis-full` (linha própria) e volta a uma linha só em `lg` (`lg:flex-nowrap`,
    `lg:basis-0`); `sm:items-start` e o espaçador do botão continuam. Rótulos, `(opcional)`,
    `inputMode="numeric"`, limpeza/foco depois do sucesso e mensagens de erro já existiam e
    não mudaram.
  - **Pendência resolvida**: carteirinha e CRM já viajavam no payload RSC da lista sem
    serem exibidos; agora são exibidos, e a página continua só de admin.
  - **Testes** (o `include` do Vitest passou a cobrir `components/**/*.test.ts`):
    `components/area-de-transferencia.test.ts` (caminho novo copia o valor exato; plano B
    quando o clipboard recusa ou não existe; falha devolve `false` e remove o campo
    temporário); `components/botao-de-copiar.test.ts` (HTML estático: nome acessível,
    rótulo, só-ícone, `aria-live` montado vazio, desabilitado);
    `app/(app)/klini/encaminhamentos/lista-de-encaminhamentos.test.ts` (sete colunas,
    números e botões habilitados, paciente antigo nulo com "falta preencher", botões
    desabilitados e dica, um campo só faltando);
    `app/(app)/klini/encaminhamentos/acesso-da-recepcao.test.ts` (página com papel
    `recepcao` no banco e cookie dizendo admin: redirect para `/klini/dashboard` **antes**
    de `listarEncaminhamentos`, com controle do admin; as três actions da tela recusadas
    sem chamar o domínio; a action do admin não devolve carteirinha/CRM nem se o domínio
    devolver; varredura do código mostrando que só a página chama
    `listarEncaminhamentos`). Mutação conferida: sem o `requireAcessoARota` na página, o
    teste da recepção cai.
  - **Não testado**: clique real, troca para "Copiado", colar o conteúdo, plano B no
    navegador, foco e layout — sem navegador nesta sessão. Ver o roteiro em pendências.

- **Carteirinha opcional para quem já tem (28/10/2026, mesma branch
  `feat/carteirinha-crm-dominio`, sobre `0bb6767`; sem commit).** Ajuste da regra 20.
  - **Função pura `decidirCarteirinha(texto, situacao)`** em `carteirinha-crm.ts`, com
    `situacao` em `paciente-novo | sem-carteirinha | com-carteirinha`. Devolve
    `gravar: string` (normalizada), `gravar: null` ("manter") ou o erro. Servidor e
    formulário chamam a mesma; o formulário deduz a situação do nome digitado.
  - **`validarEntrada` só confere o formato** quando a carteirinha vem preenchida; a
    obrigatoriedade saiu dela (depende do banco). A recusa da transação é `throw` de
    `ErroDeNegocio`, para desfazer o paciente recém-criado.
  - **Leitura travada `situacaoDaCarteirinha`**: `SELECT numero_carteirinha IS NOT
    NULL ... FOR NO KEY UPDATE` logo depois do get-or-create. Mesmo lock que o UPDATE
    pedia, só que antes — a ordem paciente → encaminhamento não muda. Devolve só o
    booleano. `paciente-novo` vem do `criado` do get-or-create (um paciente criado por
    cadastro concorrente que commitou primeiro sai como `sem-carteirinha`, com a frase
    do legado — aceitável).
  - **`gravarCarteirinhaECrm` com carteirinha `null`**: pula a checagem de dono e o
    UPDATE leva só `crmMedico`. O `SAVEPOINT` e o saneamento continuam valendo (um
    CHECK do CRM ainda seria saneado); o ramo do índice único só é considerado com
    carteirinha.
  - **Formulário**: não havia atributo `required` (o form é `noValidate`); a mudança
    foi trocar a validação local por `decidirCarteirinha`, pôr o texto de apoio com
    `aria-describedby`, "(opcional)" no rótulo e placeholder "Manter a cadastrada"
    quando o nome bate (`toLowerCase()`, aproximação do `lower()` do Postgres). A
    linha passou de `sm:items-end` para `sm:items-start` (o texto de apoio deixa a
    coluna mais alta), com um espaçador da altura do rótulo sobre o botão. A página
    usa `listarPacientesParaEncaminhamento()` (nome + booleano) em vez de
    `listarNomesDePacientes()`, que segue igual para as outras telas.
  - **Testes**: unitários de `decidirCarteirinha` (vazio/espaço/NBSP nos três casos,
    preenchido normalizado e inválido nos três); integração em rollback para novo e
    legado recusados (legado também com só espaços, sem gravar CRM nem substituir o
    encaminhamento), reenvio vazio e só com espaços mantendo a carteirinha e
    atualizando CRM e data com uma linha de paciente e uma de encaminhamento, reenvio
    com a mesma carteirinha, com carteirinha nova e com a de outro paciente (recusa
    com o nome do dono, a própria intacta). **446 testes em 28 arquivos.** Os testes
    de corrida já existentes (`situacao-requisicao`, `requisicoes`, `atendimentos`)
    falham de forma intermitente sob a suíte inteira **também sem esta mudança**
    (conferido com `git stash`); passam isolados.

- **Carteirinha e CRM do paciente (28/10/2026, branch `feat/carteirinha-crm-dominio`,
  a partir da `main` em `d7a5ef4`; sem commit, sem merge, sem push).** Regra 20. As
  decisões do caminho:
  - **Migration `20261028120000_carteirinha_e_crm_do_paciente`, aditiva**: duas
    `ADD COLUMN ... TEXT` sem default e sem `NOT NULL` (não reescreve linha nenhuma), dois
    `CHECK` (`paciente_numero_carteirinha_formato`, `paciente_crm_medico_formato`) e o
    índice `paciente_numero_carteirinha_lower_key` — `UNIQUE (lower(numero_carteirinha))
    WHERE numero_carteirinha IS NOT NULL`. No schema, `numeroCarteirinha String?` e
    `crmMedico String?` com `@map`; CHECK e índice de expressão/parcial **não** são
    expressáveis no Prisma e a introspecção os ignora (como o de `paciente.nome`).
    Conferido: `migrate dev --create-only` depois de aplicar gerou migration **vazia**
    (apagada em seguida, nunca aplicada), `migrate diff --from-config-datasource
    --to-schema` vazio, e `db pull --print` devolve o model com os dois campos e nada
    mais. Não há coluna gerada aqui, então o problema do `@default(dbgenerated)` não se
    aplica.
  - **O regex do Postgres recusa letra acentuada** (`Ç`, `é`) em `[A-Za-z0-9]` também
    na collation `Portuguese_Brazil.1252` do banco local — testado, não suposto.
  - **Domínio**: funções puras em `lib/domain/carteirinha-crm.ts` (`validarCarteirinha`,
    `validarCrm`, `normalizarCarteirinha`, `normalizarCrm`; espelho dos CHECK, como
    `PAPEIS`) e mensagens em `lib/domain/carteirinha-crm-mensagens.ts`, sem import de
    banco, lidas também pelo formulário. Normalizar é só tirar espaço (e ponto, no CRM);
    hífen, barra e "CRM/SP" **não** são removidos em silêncio — caem na validação, para
    não gravar um número diferente do documento.
  - **Nomes mantidos**: o pedido falava em `criarEncaminhamento` com `nome`; a função que
    existe é `registrarEncaminhamento` (é upsert) e o campo é `pacienteNome`. Foram
    mantidos; entraram `numeroCarteirinha` e `crmMedico` em `EntradaNovoEncaminhamento`,
    obrigatórios no tipo e em `validarEntrada` (a action só lê o `FormData`). O
    formulário de encaminhamentos ganhou os dois campos — sem eles a action passaria a
    recusar todo cadastro pela tela. Os dois voltam vazios depois do sucesso, como o nome.
  - **Ordem dentro da transação**: get-or-create → `gravarCarteirinhaECrm` (checagem
    prévia + UPDATE do paciente) → `FOR UPDATE` do encaminhamento → upsert. A
    carteirinha vem **antes** do encaminhamento por ordem de lock: o UPDATE trava a linha
    do paciente, e a exclusão de paciente vai `paciente` → `encaminhamento`; na ordem
    inversa as duas poderiam se travar em cruz. O lock do UPDATE é `FOR NO KEY UPDATE`
    (índice de expressão e parcial não conta como chave de FK), então não conflita com o
    `FOR KEY SHARE` de um INSERT de requisição/encaminhamento. Efeito colateral: dois
    cadastros simultâneos do *primeiro* encaminhamento do mesmo paciente agora se
    serializam no paciente.
  - **Checagem prévia é a mensagem; o índice é a garantia.** A checagem usa
    `lower(numero_carteirinha) = lower($1)` (a expressão do índice) e acha o dono. Na
    corrida (dois pacientes, mesma carteirinha, ninguém enxerga o outro), o segundo
    UPDATE recebe `23505` do índice. O UPDATE roda dentro de um `SAVEPOINT`: sem ele a
    transação ficaria abortada e não daria para consultar o nome; com ele, `ROLLBACK TO
    SAVEPOINT`, consulta o dono (que já commitou) e lança a mesma frase. O erro de negócio
    é **lançado** (não devolvido) para desfazer o paciente que o get-or-create acabou de
    criar — mesmo desenho de `criarRequisicao`. Se o dono sumiu entre uma coisa e outra,
    sai `ERRO_CARTEIRINHA_JA_CADASTRADA` ("... para outro paciente.").
  - **Saneamento de erro inesperado.** Uma violação de CHECK traz em
    `meta.driverAdapterError.cause.detail` o "Failing row contains (...)" do Postgres —
    a linha inteira, carteirinha e CRM inclusive —, e uma exceção não tratada é logada
    pelo Next com isso. Qualquer erro do UPDATE que não seja o do índice é relançado como
    `Error` novo, só com id do paciente e código do Prisma, **sem `cause`**. Há teste que
    adultera o `update` para provocar o CHECK e afirma que nenhum valor escapa; a mutação
    "relançar o erro cru" faz esse teste cair com `'ZZ 99887766'` no texto. Conferido
    também que o log `query` do Prisma em desenvolvimento só imprime `$1`, não o valor.
  - **Listagem**: `listarEncaminhamentos` traz `p.numero_carteirinha` e `p.crm_medico`
    (`numeroCarteirinha`/`crmMedico` em `EncaminhamentoNaLista`, `null` para legado). A
    tela **ainda não os mostra**; ver pendências.
  - **Validação**: `tsc --noEmit` limpo; eslint limpo nos arquivos tocados (`npm run
    lint` só com o erro pré-existente de `acoes-da-guia.tsx:335`); **428 testes em 28
    arquivos** (eram 376 em 26); `next build` concluído. Testes novos:
    `lib/domain/carteirinha-crm.test.ts` (limites 4/5/25/26 e 0/1/10/11, normalização,
    mensagens sem o valor) e `lib/domain/carteirinha-crm.integration.test.ts` (10 casos,
    todos em rollback: paciente novo normalizado; reenvio com CRM diferente atualiza sem
    duplicar; recusa de carteirinha de outro paciente e em outra caixa; corrida simulada
    cegando a checagem prévia — recusa pelo índice, nome do dono na mensagem, transação
    utilizável depois; saneamento; banco recusando CRM com letra, carteirinha com espaço
    e os limites sem o domínio; índice recusando caixa diferente e aceitando vários NULL;
    paciente antigo listando com nulos). Mutação conferida: sem o `SAVEPOINT`, o teste da
    corrida cai.

- **Situação da requisição (26/10/2026, branch `feat/situacao-requisicao`, sem merge e
  sem push).** Regra 19. As decisões do caminho:
  - **Escopo na requisição, não na guia.** Coluna `requisicao.situacao`, não em
    `requisicao_terapia`: é a pasta que é enviada ao convênio e aprovada. O botão de
    qualquer guia muda todas as guias do mesmo número, e o `aria-label` diz isso.
  - **Nome `situacao`, não `status`**, para não confundir com `status_alerta`.
  - **Migration no mesmo desenho da de `papel`** (`20261026130000_situacao_da_requisicao`):
    `ADD COLUMN ... NOT NULL DEFAULT 'aprovada'` só para backfillar, `DROP DEFAULT` logo
    em seguida, e então o `CHECK` `requisicao_situacao_valida`. **Backfill como
    `aprovada`** porque toda requisição que existia já tinha quantidade autorizada e
    atendimentos lançados — no banco local, as quatro saíram `aprovada`. Sem default
    permanente: toda inserção informa a situação, e o schema declara `situacao String`
    sem `@default` (`migrate diff --from-config-datasource --to-schema` vazio). O espelho
    em TypeScript é `SITUACOES_DE_REQUISICAO` em `lib/domain/situacao-requisicao.ts`
    (módulo sem banco, lido também pelo cliente), junto de `aceitaLancamento` — a mesma
    função decide no servidor e desabilita a guia na tela.
  - **Quem pode alterar** é `podeAlterarSituacaoDeRequisicao(papel)` em
    `lib/auth/acesso.ts`, a fonte única que a action e o painel leem. Não é regra de rota
    (o painel é dos dois papéis), por isso não passa por `podeAcessarRota`. A action
    `alterarSituacaoDaRequisicaoAction` (`lib/domain/situacao-requisicao-actions.ts`)
    chama `requireUsuario()` e decide pelo papel **do banco**; recusa devolve
    `MENSAGEM_SEM_PERMISSAO`. No sucesso, `revalidatePath` do painel e de
    `/klini/atendimentos/novo`. O domínio (`alterarSituacaoDaRequisicao`, em
    `requisicoes.ts`) valida id e situação e faz **um** `UPDATE ... RETURNING`.
  - **Bloqueio só no lançamento.** `lancarLoteNaTransacao`, depois do `FOR UPDATE` das
    guias, faz `SELECT ... FROM requisicao WHERE id IN (requisições dessas guias) ORDER BY
    id FOR SHARE` e lê a situação **no mesmo comando que trava** — se uma mudança estava
    em curso, o `FOR SHARE` esperou o commit dela e o READ COMMITTED devolve a linha nova.
    A checagem de situação roda para todos os itens **antes** da de saldo (requisição
    pendente torna o ajuste de créditos inútil) e devolve `erroRequisicaoSolicitada(N)`.
    Editar e excluir atendimento não leem a situação.
  - **Por que `FOR SHARE`, e não `FOR UPDATE`:** o UPDATE da situação pede
    `FOR NO KEY UPDATE`, que conflita com `FOR SHARE` — é o que serializa lançamento e
    mudança de situação. Dois lançamentos na mesma requisição não precisam se esperar por
    ela (`FOR SHARE` não conflita consigo mesmo); quem serializa o saldo continua sendo a
    guia.
  - **Ordem de lock completa** (analisada caminho a caminho, documentada no topo de
    `lib/domain/atendimentos.ts`): lançamento trava guia (FOR UPDATE, por id) → requisição
    (FOR SHARE, por id) e nunca `paciente`; alterar situação trava **só** a linha de
    `requisicao`, segura um lock e não espera outro com ele de pé; exclusão de guia e
    edição de atendimento travam só a guia; exclusão de atendimento não trava a guia pai;
    exclusão de paciente vai `paciente` → guias (DELETE) → requisições (DELETE), a mesma
    direção guia → requisição; o INSERT de guia do cadastro pede `FOR KEY SHARE` na
    requisição, que não conflita nem com `FOR SHARE` nem com o UPDATE da situação. Nenhum
    caminho segura requisição esperando guia, então não há ciclo novo. (Fica como estava
    um risco **pré-existente**, não introduzido aqui: o DELETE das guias na exclusão de
    paciente trava várias guias sem `ORDER BY`, e um lançamento simultâneo com duas ou
    mais guias do mesmo paciente poderia, em tese, cruzar com ele. O Postgres detectaria
    o deadlock e abortaria uma das duas transações; nada fica pela metade.)
  - **Tela de lançamento:** `listarGuiasDisponiveisDoPaciente` traz `situacaoRequisicao`;
    as guias de requisição solicitada aparecem desabilitadas com "Aguardando aprovação
    (requisição N)", ficam fora do "Marcar todas" e da contagem dele, e se nenhuma guia do
    paciente for lançável o botão fica desabilitado com a explicação ao lado
    (`aria-describedby`). A lista de pacientes não mudou: um paciente só com guias
    solicitadas continua no `select`, para a tela poder explicar o porquê.
  - **Painel:** `listarGuiasDoDashboard` traz `r.situacao` (o join já existia). Selo
    `SeloDeSituacao` sobre `components/selo-de-status.tsx`, ao lado do `StatusBadge`, nas
    duas versões (tabela, coluna "Status · situação", e bloco móvel). "Solicitada": contorno
    grafite, `Clock`, peso 600. "Aprovada": texto `muted-foreground`, `CircleCheck`, sem
    contorno nem fundo, peso 400 — quase tudo é aprovada depois do backfill. **Nenhuma cor
    saturada nova.** Para admin, botão `xs` "Aprovar" / "Voltar para solicitada" com
    `aria-label` descritivo e toast (sonner) no sucesso e no erro.
  - **Cabeçalho do paciente recolhido** (mesmo dia, mesma branch): mostra o mesmo
    `SeloDeSituacao` "Solicitada" (relógio, contorno grafite, sem cor nova) quando
    **qualquer** guia do paciente é de requisição solicitada — sem contagem, e nada quando
    todas estão aprovadas. Mesmo raciocínio do pior status: nenhuma pendência fica
    escondida num paciente fechado. A decisão é `temRequisicaoSolicitada`, em
    `lib/domain/guias-apresentacao.ts`, ao lado de `piorStatus`, e só resume o
    `situacaoRequisicao` que a listagem já trazia: nenhuma query nem regra mudou. O selo
    vem **depois** do pior status, dentro do botão de abrir (com prefixo `sr-only`
    "Requisição pendente:"); checkbox e copiar continuam controles irmãos, fora dele. O
    cabeçalho é a mesma linha para a tabela e para a lista móvel, então vale nos dois; no
    celular é o nome que trunca primeiro. Testes: unitário do helper e
    `app/(app)/klini/dashboard/lista-de-guias.test.ts`, que renderiza a lista recolhida e
    confere presença, ausência, ordem em relação ao pior status e a separação dos três
    controles.
  - O relatório semanal (`lib/relatorio/`) não olha a situação; só os fixtures dos
    testes ganharam o campo novo do tipo.
  - **Validação:** `tsc --noEmit` limpo; **370 testes em 25 arquivos**; `next build`
    concluído; `npm run lint` só com o erro pré-existente de `acoes-da-guia.tsx:335`.
    Integração nova em `lib/domain/situacao-requisicao.integration.test.ts` (17 testes):
    backfill lido do arquivo sobre cópia temporária, CHECK, insert sem situação recusado,
    nasce solicitada, acréscimo não muda, recusa simples e lote misto sem gravar nada,
    editar/excluir em solicitada, action com papel lido do banco (recepção recusada, admin
    aprova, idempotente, volta para solicitada), listagem e **duas corridas** com portão e
    `pg_stat_activity` (lançamento segura e o UPDATE espera; UPDATE segura e o lançamento
    espera e decide com a situação nova). Mutação conferida: sem o `FOR SHARE`, as duas
    corridas falham. Unitário renderiza `SituacaoDaRequisicao` em HTML estático: botão
    para admin, nenhum para recepção.
  - **Verificação ponta a ponta por HTTP** contra `next start` local, com duas contas
    temporárias (admin e recepção, login real pela action): requisição nova gravada
    `solicitada`; a guia dela veio marcada `solicitada` para a recepção; lançamento
    recusado com a mensagem e 0 atendimentos; recepção chamando a action direto recebeu
    `MENSAGEM_SEM_PERMISSAO` e a situação não mudou; admin aprovou; o mesmo lançamento
    gravou 1 atendimento; voltar para solicitada bloqueou de novo. O payload do painel
    levou `podeAlterarSituacao: true` para o admin e `false` para a recepção. Requisição,
    guia, atendimento e contas da verificação foram apagados.
  - **Interação manual no navegador pendente:** nenhum navegador disponível nesta sessão
    (o Chromium em cache do Playwright não abre no WSL por falta de `libnss3`). Ver
    pendências.

- **Terapia repetida atualiza a guia existente (26/10/2026, branch
  `feat/terapia-repetida-atualiza-guia`). REVERTE uma decisão anterior.** Em 14/09/2026
  (`feat/adicionar-terapia-requisicao-existente`) ficou registrado que a mesma
  `terapia_id` sob a mesma `requisicao_id` era "legítima e comum — a segunda autorização
  da mesma terapia", e o ramo que acrescenta terapias a uma requisição existente inseria
  todas as linhas sem olhar se a terapia já estava lá. **Isso deixou de valer.** Agora:
  - Dentro da mesma transação de sempre, o ramo "requisição já existe" faz um `findMany`
    das guias daquela requisição para as terapias pedidas. A terapia que já tem guia vira
    `tx.requisicaoTerapia.update` no `id` dela (`qtd_autorizada` e `validade`, inclusive
    `validade = null` se o campo veio vazio — o campo nasce preenchido, então vazio é
    apagado de propósito); as outras entram por `createMany`. **Nunca DELETE + INSERT**:
    apagar a guia levaria os atendimentos pelo cascade e zeraria saldo e histórico.
  - A conferência de terapia inexistente continua antes de qualquer escrita, e o `throw`
    continua desfazendo tudo: um envio com uma terapia repetida e uma linha ruim não
    atualiza nada (teste de integração commitado, não só dentro de rollback).
  - `ResultadoCriacao` ganhou `terapiasAtualizadas` (e `terapiasAdicionadas` passou a
    contar só inserções). `mensagemDeCriacao` recebe os dois números: "N terapia(s)
    adicionada(s) à requisição Y de X", "N terapia(s) atualizada(s) na requisição Y de X"
    ou "N adicionada(s) e M atualizada(s) na requisição Y de X". Requisição nova continua
    "Requisição criada para X".
  - Duas linhas da mesma terapia **no mesmo envio** são recusadas em `validarEntrada` (e
    no cliente) com `ERRO_TERAPIA_REPETIDA_NO_ENVIO`, apontando a segunda linha: não há
    leitura certa de qual quantidade vale, e o envio de requisição nova esbarraria na
    UNIQUE.
  - Migration `20261026120000_guia_unica_por_terapia_na_requisicao`: troca o índice comum
    `requisicao_terapia_requisicao_id_idx` pela UNIQUE
    `requisicao_terapia_requisicao_id_terapia_id_key` (que começa por `requisicao_id` e
    serve às mesmas buscas — mesmo raciocínio da migration de `encaminhamento`). No schema:
    `@@unique([requisicaoId, terapiaId])` sem `map`, porque o nome segue a convenção do
    Prisma; `prisma migrate diff --from-config-datasource --to-schema` deu migration vazia.
    **A migration não deduplica**: antes do índice, um bloco `DO` aborta com a consulta de
    duplicatas na mensagem se houver alguma. Juntar guias mexe em saldo e histórico de
    atendimentos, então a decisão é humana, caso a caso. No banco local não havia nenhuma.
  - A corrida de dois envios simultâneos trazendo a mesma terapia **nova** para a mesma
    requisição é pega pela UNIQUE e traduzida em `erroCorridaNaGuia` (pede reenvio, que
    cai no UPDATE). Nisso apareceu um defeito latente: com o `@prisma/adapter-pg`, o
    `meta` do `P2002` **não tem `target`** — o nome da constraint vem em
    `meta.driverAdapterError.cause.constraint.index`. O antigo `ehNumeroDuplicado` lia só
    `target`, então a tradução da corrida do **número** nunca casava em produção. O novo
    `violouUnique(erro, nome)` serializa o `meta` inteiro e cobre as duas formas; há teste
    unitário com o formato real do adapter.
  - Uma consequência a saber: atualizar para uma `qtd_autorizada` **menor** que o já
    consumido é aceito (nada mudou na validação de quantidade), e a view mostra saldo
    negativo / `Esgotada`. Não foi pedido bloqueio; se vier a ser, é uma checagem contra a
    view dentro da transação, antes do UPDATE.

- **SulAmérica — Fase D (17/09/2026, branch `feat/sulamerica`).** Migration
  `20260917160000_autorizacao_sulamerica` cria tabela, CHECK, UNIQUE, FK RESTRICT e view.
  A coluna gerada usa `((data_inicio + (prazo_meses * INTERVAL '1 month'))::date) STORED`.
  O schema declara DateTime? com a expressão exata de `prisma db pull --print`:
  `@default(dbgenerated("((data_inicio + ((prazo_meses)::double precision * '1 mon'::interval)))::date"))`.
  O diff contra o banco local foi vazio, sem tentativa de DROP DEFAULT.
  - Domínio em `lib/domain/autorizacoes-sulamerica.ts`, actions no módulo ao lado.
    Reutiliza `obterOuCriarPaciente`; trava o paciente antes de consultar a autorização
    anterior e fazer upsert, serializando inclusive dois primeiros cadastros concorrentes.
    Datas entram e saem como AAAA-MM-DD; vencimento só volta pelo RETURNING do banco.
  - A view compara date_trunc('month', data_vencimento) ao CURRENT_DATE do banco:
    Vencido / Vence este mês / A vencer / NULL. O CASE de prioridade mora só no ORDER BY.
  - (Desde 28/10/2026 o formulário saiu do painel para `/sulamerica/encaminhamentos` — ver
    "Encaminhamentos da SulAmérica" nas decisões.) `/sulamerica/dashboard` tinha formulário inline, autocomplete, início editável com
    padrão vindo de `dataDeHoje()`, prazo obrigatório sem seleção inicial, resumo,
    busca sem acento/caixa e tabela/lista móvel. Reutiliza `SeloDeVencimento` (sobre
    `components/selo-de-status.tsx`) e `ResumoDeVencimentos`, que ganhou rótulo acessível
    configurável. Nenhum status Regular/Renovar/Esgotada foi usado nesta tela.
  - A exclusão por id faz um único DELETE em autorizacao_sulamerica, sem cascata nem
    remoção de paciente. Diálogo simples, sem palavra digitada, mantém erro aberto.
    A exclusão completa já existente em Encaminhamentos ganhou o DELETE da autorização
    antes de apagar paciente e a consulta/aviso de sua existência na confirmação.
  - O allowlist da Fase C já bloqueia todo `/sulamerica`; não foi criada segunda lista
    no proxy. Página e actions chamam requireAcessoARota/autorizarRota com ROTA_SULAMERICA,
    lendo papel do banco. Menu filtra o novo link pela mesma regra. A raiz perdeu o
    texto “Em construção”; `/sulamerica` redireciona ao painel depois da autorização.
    “Trocar convênio” no cabeçalho do painel leva à raiz para escolher outro convênio.

- **Menu por convênio (17/09/2026, branch `fix/navegacao-por-convenio`).**
  `itensDeNavegacaoPara(papel, caminho)` seleciona uma lista pelo prefixo exato
  `/klini` ou `/sulamerica` (incluindo subrotas), depois aplica o mesmo
  `podeAcessarRota` da Fase C. Klini tem seus cinco itens; SulAmérica tinha apenas
  “Painel”, para `/sulamerica/dashboard`, em lista própria pronta para novas páginas
  (desde 28/10/2026 também “Encaminhamentos”, `/sulamerica/encaminhamentos`).
  A raiz de escolha não exibe itens de nenhum convênio. Não há links cruzados nas listas.
  O layout reaproveita `PATHNAME_HEADER` (`x-klini-pathname`) como caminho inicial
  da navegação, sem novo header nem alteração no proxy. A `Navegacao` reutiliza seu
  `usePathname` existente para atualizar lista e destaque nas transições via `Link`:
  layouts compartilhados não renderizam novamente a cada navegação no Next.js.
  “Trocar convênio” continua separado no painel SulAmérica; o painel Klini ganhou
  o equivalente para admin, pois antes não o tinha. Ambos levam à escolha na raiz.
  Nenhuma regra de acesso foi alterada; recepção continua vendo só Painel,
  Lançar atendimento e Atendimentos de hoje no Klini.
  - Validação: `tsc --noEmit`, **332 testes em 23 arquivos** e `next build` passaram.
    Verificação HTTP contra o build local em `127.0.0.1:3100`, com sessões assinadas
    de contas locais existentes, confirmou cinco itens Klini para admin, um item
    SulAmérica para admin, três itens Klini para recepção e “Trocar convênio” fora
    do menu nos dois painéis do admin. Também confirmou as telas de atendimento,
    a raiz sem menu para admin e os redirects da recepção na raiz e em SulAmérica.
    Nenhuma conta, senha ou dado foi alterado; essa verificação não exercitou o login.
  - **Teste visual e transições por cliques pendentes:** a conexão do Browser retornou
    “No browser is available” e a lista de navegadores estava vazia. HTTP não valida
    layout nem transições via `Link`. Conferir localmente Klini → Trocar convênio →
    SulAmérica → Trocar convênio → Klini, além do menu da recepção.
    Sem merge, push ou deploy; aguarda validação local do usuário.

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
  `/sulamerica/dashboard`, que **passou a funcionar na Fase D**. A marca "VIGIA" do cabeçalho passou a
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
  - **Get-or-create do paciente em uma consulta só** (desde 28/10/2026 usado só pelo
    cadastro de encaminhamento da Klini e pelo da SulAmérica — a requisição só busca; ver
    regra 21): `INSERT ... ON CONFLICT
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
`autorizacao_sulamerica` -> `paciente`. As FKs envolvidas são `ON DELETE RESTRICT`, então qualquer outra ordem é
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
- Não "atualizar" guia com DELETE + INSERT. A guia é pai dos atendimentos por
  `ON DELETE CASCADE`; recriá-la apaga o histórico e zera o saldo. Terapia repetida é
  UPDATE no `id` existente.
- Não remover nem afrouxar a UNIQUE `requisicao_terapia_requisicao_id_terapia_id_key`, e
  não voltar a criar segunda guia da mesma terapia na mesma requisição (decisão revertida
  em 26/10/2026). Não deduplicar guias em migration automaticamente: cada uma pode ter
  atendimentos.
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
- Não reimplementar busca/criação de paciente por nome: use `obterOuCriarPaciente`
  (criação, só no cadastro de paciente), `exigirPacienteDoConvenio` (busca dos
  encaminhamentos, com lock e convênio) ou `buscarPacientePorNome` (busca da requisição,
  com lock) de `lib/domain/pacientes.ts`. Uma segunda implementação com outra regra de comparação
  discordaria do índice `UNIQUE (lower(nome))`.
- Não criar paciente fora do cadastro de paciente (`cadastrarPaciente`, aba Cadastro,
  regras 23 e 24) — nem nos encaminhamentos, nem em requisição, nem em atendimento, nem no painel da SulAmérica, nem em
  script ou rota nova. Não há mais exceção temporária; não acrescentar uma. Não
  "afrouxar" `pacientes-origem.test.ts` para um caminho novo passar: um caminho novo que
  crie paciente é conversa, não ajuste.
- Não duplicar a gravação de carteirinha/CRM num terceiro fluxo nem copiá-la para a
  SulAmérica: ela mora em `lib/domain/carteirinha-crm-gravacao.ts`
  (`gravarCarteirinhaECrmNaTransacao`, `ErroDeNegocio`), usada pelos dois cadastros.
- Não pôr `NOT NULL` (nem default) em `autorizacao_sulamerica.nome_medico`: as autorizações
  antigas não têm o dado. Não mudar a regra do nome do médico só no `CHECK` ou só em
  `lib/domain/nome-medico.ts`. Não padronizar a caixa do nome. Não logar o nome do médico,
  nem repeti-lo em mensagem de erro ou URL (o erro do upsert é saneado como o da
  carteirinha).
- Não pôr carteirinha, CRM nem nome do médico na lista do painel da SulAmérica
  (`listarAutorizacoes`, que os descarta): só a página `/sulamerica/encaminhamentos` chama
  `listarEncaminhamentosSulamerica`, e há teste de varredura que cai se outro chamar.
- Não bloquear requisição de paciente antigo por falta de carteirinha/CRM: o legado é
  aceito de propósito (regra 21); a pendência é preencher, não barrar.
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
- Não checar paciente nem encaminhamento **antes** da transação de `criarRequisicao`
  (nem em `validarEntrada`, nem só no cliente). A checagem mora na transação, depois do
  `FOR KEY SHARE` de `buscarPacientePorNome`: fora dela, uma exclusão de paciente poderia
  passar entre a checagem e o INSERT. E não trocar o `throw` da recusa por um
  `return { ok: false }` — o `throw` é o que desfaz qualquer escrita anterior da
  transação. Não tirar o `FOR KEY SHARE` da busca.
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
- Não pôr a situação da requisição na view `requisicao_terapia_saldo`, nem fazê-la
  influir no `status_alerta`. É dado gravado, não calculado; uma guia solicitada continua
  avaliada pelas mesmas regras de saldo e validade.
- Não repor default em `requisicao.situacao` (nem `'solicitada'`, nem `'aprovada'`). O
  `DEFAULT 'aprovada'` existe só dentro da migration
  `20261026130000_situacao_da_requisicao`, como backfill, e é derrubado no comando
  seguinte; há teste que cai. Toda inserção informa a situação.
- Não acrescentar situação só no `CHECK` ou só em `SITUACOES_DE_REQUISICAO`
  (`lib/domain/situacao-requisicao.ts`): mudam no mesmo commit.
- Não mover a situação para a guia (`requisicao_terapia`). Ela é da requisição inteira.
- Não estender o bloqueio de requisição solicitada à edição ou exclusão de atendimento:
  ele vale só para lançar atendimento novo.
- Não ler a situação num SELECT separado do `FOR SHARE` em `lancarLoteNaTransacao`, nem
  trocar a ordem guias → requisições, nem fazer `alterarSituacaoDaRequisicao` travar
  outra tabela. A ausência de deadlock depende dessa ordem.
- Não decidir quem altera a situação fora de `podeAlterarSituacaoDeRequisicao`.
- Não versionar dados reais de paciente — nome, carteirinha, CRM ou qualquer outro — em
  seed, fixture, teste, migration, script ou documentação. Valores de teste são
  sintéticos (`carteirinhaDeTeste()`, `"123456"`).
- Não logar carteirinha nem CRM (`console.*`, mensagem de exceção, `cause` de erro), não
  repeti-los em mensagem de erro para o usuário e não passá-los por URL ou query string
  (nem em toast via `?param=`, como o cadastro de requisição faz com o nome). Erro de banco
  no UPDATE desses campos é saneado antes de escapar — não "simplificar" relançando o erro
  cru: o `meta` do Prisma carrega a linha inteira na violação de CHECK.
- Não pôr `NOT NULL` (nem default inventado) em `paciente.numero_carteirinha` /
  `paciente.crm_medico`: pacientes antigos não têm esses dados.
- Não mudar formato de carteirinha/CRM só no `CHECK` da migration ou só em
  `lib/domain/carteirinha-crm.ts`: mudam no mesmo commit.
- Não comparar carteirinha com outra expressão que não `lower(numero_carteirinha)` — é a
  do índice único; outra regra faria checagem e constraint discordarem.
- Não tirar o `SAVEPOINT` de `gravarCarteirinhaECrm` nem mover o UPDATE do paciente para
  depois do lock do encaminhamento (ordem de lock: paciente → encaminhamento).

- Não marcar a caixinha "Substituir" por padrão sem decisão do usuário (`SUBSTITUIR_PADRAO`
  no formulário): ela apaga atendimentos.
- Não apagar guia da **mesma** requisição (mesmo número) na substituição: ela segue o
  UPDATE da regra 5. Não estender a substituição a outro paciente nem a terapia que não
  veio no envio.
- Não escrever um segundo DELETE de guia para a substituição: ela usa
  `excluirGuiaNaTransacao`. Não tirar o `FOR UPDATE OF rt ... ORDER BY id` nem trocar a
  ordem guia → requisição.
- Não confiar na prévia para apagar: o servidor refaz a consulta dentro da transação.

- Não pôr campo calculado nem soma no plano de terapias (total semanal, saldo, etc.), nem
  fazer saldo/guia/atendimento depender dele: o plano é informativo (regra 23).
- Não mudar os limites do tempo semanal só no CHECK `plano_terapia_minutos_semanais_validos`
  ou só em `lib/domain/tempo-semanal.ts`, nem os convênios só no CHECK
  `paciente_convenio_valido` ou só em `CONVENIOS` (`lib/domain/convenio.ts`): mudam juntos.
- Não converter horas em minutos com ponto flutuante (`Number(...) * 60`): a conta é com
  inteiros em `lerHorasSemanais`.
- Não "escolher" convênio para paciente com encaminhamento **e** autorização: fica NULL até
  decisão humana. Não trocar o convênio de um paciente pelo cadastro (outro convênio é
  recusado).
- Não acrescentar `DELETE FROM plano_terapia` à exclusão de paciente: vai pelo cascade.
- Não criar paciente por outro caminho além de `cadastrarPaciente`.
- Não fazer o encaminhamento "decidir" o convênio de um paciente com `convenio` NULL: quem
  decide é o Cadastro (regra 24).
- Não mandar carteirinha nem CRM para a tela Cadastro (`listarPacientesDoConvenio` traz só
  nome e plano).

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

- [x] Fase D — SulAmérica implementada em `feat/sulamerica`, a partir da main com A/B/C.
      Migration aplicada **somente no Postgres local localhost:5432/klini**. Nenhum merge,
      push ou deploy foi feito; validação local do usuário precede publicação.
  - `tsc --noEmit` limpo, **318 testes passando em 23 arquivos**, `next build` concluído
    com as duas rotas SulAmérica. Integração cobre os três prazos, finais de mês e ano
    bissexto, upsert case-insensitive, constraints, coluna gerada protegida, exclusão
    preservando paciente/requisição/guia/atendimento/encaminhamento e ordenação mensal.
    Testes de proxy, menu e chamada direta das actions cobrem os dois papéis.
  - `prisma db pull --print` confirmou a expressão gerada e `prisma migrate diff
    --from-config-datasource --to-schema prisma/schema.prisma --script` retornou migration
    vazia. `npm run lint` aponta apenas o erro pré-existente em acoes-da-guia.tsx:335.
  - Verificação HTTP contra `next start` local: login real com contas temporárias admin e
    recepção; raiz e painel 200 para admin; prazo sem pré-seleção no HTML; menu sem link
    SulAmérica para recepção e 307 para o Klini em /sulamerica e subrotas. Actions reais
    cadastraram 31/01/2026 + 3 = 30/04/2026, 31/08/2026 + 6 = 28/02/2027 e
    29/02/2028 + 12 = 28/02/2029. Upsert e exclusão confirmados no banco, com paciente
    preservado. Rebaixar a conta temporária a recepção mantendo cookie admin provou a
    recusa autoritativa da página e de ambas as actions, sem criar/apagar registros.
    Todas as contas e os dados temporários dessa verificação foram removidos.
  - **Interação manual no navegador pendente:** nenhum navegador estava conectado nesta
    sessão. HTTP valida respostas e gravações, mas não cliques, foco, toast ou layout.

- [x] Terapia repetida atualiza a guia existente (26/10/2026, branch
      `feat/terapia-repetida-atualiza-guia`, **sem merge e sem push**) — **reverte** a
      decisão de 14/09/2026 de criar segunda guia da mesma terapia. Ver "Terapia repetida
      atualiza a guia existente" nas decisões de implementação.
  - Migration `20261026120000_guia_unica_por_terapia_na_requisicao` aplicada **somente no
    Postgres local** (`localhost:5432/klini`), depois de a consulta de duplicatas por
    `(requisicao_id, terapia_id)` voltar vazia. `migrate diff` contra o schema: vazio.
    **Pendente: aplicar no Supabase depois do merge.**
  - Integração nova (contra o banco local): terapia repetida atualiza `qtd_autorizada` e
    `validade` no mesmo `id`, sem segunda linha; atendimentos lançados continuam e a view
    recalcula (4 → 12 autorizados, 3 usados: saldo 1/`Renovar` → 9/`Regular`); mistura
    repetida + nova = 1 atualização e 1 inserção; envio com repetida + terapia inexistente
    via `criarRequisicao` commitado não altera nada; INSERT cru duplicado recusado pela
    UNIQUE. A fixture de `pacientes.integration.test.ts` usava a mesma terapia em duas
    guias e passou a usar duas terapias.
  - `tsc --noEmit` limpo, **348 testes passando em 23 arquivos**, `next build` concluído.
  - **Interação manual no navegador pendente** — passo 5 do roteiro do acréscimo de
    terapia (pendências) foi reescrito para o comportamento novo.

- [x] Situação da requisição — solicitada/aprovada (26/10/2026, branch
      `feat/situacao-requisicao`, **sem merge e sem push**). Ver regra 19 e "Situação da
      requisição" nas decisões de implementação.
  - Migration `20261026130000_situacao_da_requisicao` aplicada **somente no Postgres
    local**. `migrate diff` contra o schema: vazio. Seed rodado no local: a requisição
    `2026-0004` (Ana Beatriz Moraes) existe como `solicitada` para demonstração.
    **Pendente: aplicar no Supabase — ver a ordem em pendências.**
  - `tsc --noEmit` limpo, **376 testes passando em 26 arquivos** (depois do indicador no
    cabeçalho recolhido), `next build` concluído.
  - Verificação ponta a ponta por HTTP feita; **interação manual no navegador pendente**.

- [x] Carteirinha e CRM do paciente (28/10/2026, branch `feat/carteirinha-crm-dominio`,
      **sem commit, sem merge e sem push**). Ver regra 20 e "Carteirinha e CRM do
      paciente" nas decisões de implementação.
  - Migration `20261028120000_carteirinha_e_crm_do_paciente` aplicada **somente no
    Postgres local** (`localhost:5432/klini`). `migrate diff` contra o schema: vazio.
    **Pendente: aplicar no Supabase — ver pendências.**
  - `tsc --noEmit` limpo, **428 testes passando em 28 arquivos**, `next build` concluído.
  - **Não verificado**: cadastro pela tela no navegador, Server Action por HTTP e
    `registrarEncaminhamento` (a variante que abre a própria transação) commitando de
    verdade — os testes de integração usam a variante "na transação", com rollback.

- [x] Carteirinha e CRM na tela de Encaminhamentos (28/10/2026, branch
      `feat/carteirinha-crm-klini-ui`, **sem commit, sem merge e sem push**). Colunas com
      botão de copiar separado, "falta preencher" para paciente antigo, formulário na
      ordem nome → data → carteirinha → CRM, botão de copiar movido para `components/`.
      Ver "Carteirinha e CRM na tela de Encaminhamentos" nas decisões de implementação.
  - `tsc --noEmit` limpo, eslint limpo nos arquivos tocados, **466 testes em 32
    arquivos**, `next build` concluído.
  - **Interação manual no navegador pendente** — roteiro em pendências.

- [x] Paciente só pelo encaminhamento (28/10/2026, branch
      `feat/paciente-so-por-encaminhamento`, **sem commit, sem merge e sem push**).
      Ver regras 15 e 21 e "Paciente só pelo encaminhamento" nas decisões de
      implementação. Nenhuma migration.
  - `tsc --noEmit` limpo, eslint limpo nos arquivos tocados, **476 testes em 33
    arquivos**, `next build` concluído.
  - **Interação manual no navegador pendente** — roteiro em pendências.

- [x] **P1 — Convênio, plano de terapias e cadastro de paciente: banco e domínio**
      (29/10/2026, branch `feat/cadastro-plano-dominio`, commit `92ec032`, sem merge e sem
      push). Regra 23. Migration `20261029120000_convenio_e_plano_de_terapias` aplicada
      **só no Postgres local**. `tsc --noEmit` limpo, eslint limpo nos arquivos tocados,
      **673 testes em 40 arquivos**, `next build` concluído. O "em andamento" acabou com o
      item abaixo.

- [x] **Aba Cadastro e encaminhamento só de paciente existente** (29/10/2026, branch
      `feat/cadastro-plano-ui`, a partir de `feat/cadastro-plano-dominio` em `92ec032`;
      **sem commit, sem merge e sem push**). Regra 24. Nenhuma migration.
      `tsc --noEmit` limpo, eslint limpo nos arquivos tocados (o único erro do `eslint` do
      projeto é o `react-hooks/set-state-in-effect` de
      `app/(app)/klini/dashboard/acoes-da-guia.tsx`, que já existia e não foi tocado),
      **710 testes em 43 arquivos**, `next build` concluído (rotas `/klini/pacientes` e
      `/sulamerica/pacientes`). **Interação manual no navegador pendente** — roteiro em
      pendências.

- [x] Substituir guias da mesma terapia (29/10/2026, branch `feat/substituir-requisicao`,
      **sem commit, sem merge e sem push**). Ver regra 22 e a decisão correspondente.
      Nenhuma migration.
  - `tsc --noEmit` limpo, eslint limpo nos arquivos tocados, **582 testes em 38
    arquivos**, `next build` concluído.
  - **Interação manual no navegador pendente** — roteiro em pendências.

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
- [x] **Fase D — SulAmérica.** Implementada: autorizações de 3, 6 ou 12 meses,
      vencimento e status no banco, cadastro/substituição, exclusão isolada, busca,
      resumo e navegação. Exclusiva de admin nas duas camadas. O link da raiz funciona.
      **Plano de quatro fases completo em implementação.** Aguarda validação local
      interativa do usuário antes de merge e publicação.

## Pendências conhecidas (não bloqueiam o próximo passo, mas não esquecer)

- **Migration `20261029120000_convenio_e_plano_de_terapias` a aplicar no Supabase ANTES do
  deploy.** Aditiva (coluna NULL + CHECK que NULL passa + `UPDATE` de preenchimento +
  tabela nova): o código antigo não lê nem grava nada disto e continua funcionando com ela
  aplicada; o código novo sem ela quebra no cadastro e nas leituras do plano. Ordem:
  **(1)** merge; **(2)** antes de aplicar, ver quantos pacientes têm os dois cadastros —
  `SELECT count(*) FROM paciente p WHERE EXISTS (SELECT 1 FROM encaminhamento e WHERE
  e.paciente_id = p.id) AND EXISTS (SELECT 1 FROM autorizacao_sulamerica a WHERE
  a.paciente_id = p.id);` — esses ficam NULL e precisam de decisão humana; **(3)** `npm run
  db:migrate:deploy`; **(4)** conferir os GRANTs do `vigia_app` na tabela nova (as
  migrations não têm GRANT): `SELECT grantee, privilege_type FROM
  information_schema.role_table_grants WHERE table_name = 'plano_terapia';` e o mesmo para
  a sequência (`\dp plano_terapia_id_seq`). Se faltar: `GRANT SELECT, INSERT, UPDATE,
  DELETE ON plano_terapia TO vigia_app; GRANT USAGE, SELECT ON SEQUENCE
  plano_terapia_id_seq TO vigia_app;` (à mão, como os grants anteriores). Avaliar também
  `ALTER TABLE plano_terapia ENABLE ROW LEVEL SECURITY;` para seguir
  `scripts/supabase/enable-rls.sql`; **(5)** deploy; **(6)** `SELECT convenio, count(*) FROM
  paciente GROUP BY 1;`.
- **Pacientes com encaminhamento e autorização ao mesmo tempo** ficam com `convenio` NULL
  pela migration — no local não há nenhum; em produção, conferir (passo 2 acima). Desde a
  regra 24 esses pacientes são **recusados nos dois encaminhamentos** até alguém
  cadastrá-los na aba Cadastro do convênio certo (o Cadastro adota o convênio).
- **Preencher o plano dos pacientes antigos.** Quem existia antes de 29/10/2026 aparece na
  aba Cadastro com "Plano não cadastrado" (se a migration lhe deu convênio) ou em nenhuma
  aba (convênio NULL). O preenchimento é manual: "Editar" na lista, ou digitar o nome no
  formulário do Cadastro do convênio certo. Nada bloqueia o paciente sem plano — o plano é
  informativo.
- **Aba Cadastro: roteiro manual de navegador** (nada disto foi feito; sem navegador nesta
  sessão). Como admin:
  1. **Cadastrar na Klini com 2 terapias**: menu Klini → "Cadastro" (`/klini/pacientes`).
     O menu não mostra itens da SulAmérica; "Trocar convênio" no cabeçalho. Nome novo,
     terapia 1 = Fono, "2"; "Adicionar terapia", terapia 2 = TO, "1,5". Na linha 2, Fono
     aparece desabilitada. "Cadastrar paciente" → "Paciente cadastrado.", formulário
     vazio, foco no nome; na lista, "Fono 2 h · TO 1 h 30 min" (nomes do catálogo).
  2. **Editar e trocar o plano**: "Editar" no paciente → nome travado com o texto de
     apoio, linhas preenchidas ("2" e "1,5"), botão "Salvar plano" e "Cancelar edição".
     Remover TO, mudar Fono para "0,75" → "Plano atualizado."; a lista mostra "Fono 45
     min". Testar também "0,1" (recusa de passo, linha marcada) e campo vazio.
  3. **Cadastrar na SulAmérica**: menu SulAmérica → "Cadastro" (`/sulamerica/pacientes`);
     o menu não mostra itens da Klini. Cadastrar outro paciente; ele aparece só nesta
     lista, não na da Klini.
  4. **Nome inexistente no Encaminhamento**: em `/klini/encaminhamentos`, nome que não
     existe, data, carteirinha e CRM → "Paciente não cadastrado. Cadastre primeiro em
     Cadastro." com o link "Ir para Cadastro", que leva a `/klini/pacientes`; nada aparece
     na lista. Repetir em `/sulamerica/encaminhamentos` (link para `/sulamerica/pacientes`).
  5. **Paciente de outro convênio**: em `/klini/encaminhamentos`, digitar o nome do
     paciente do passo 3 (ele **não** aparece no datalist) → recusa "Este paciente está
     cadastrado no outro convênio…", sem link. E o caminho feliz: o paciente do passo 1
     aparece no datalist e o encaminhamento passa (carteirinha obrigatória se ele ainda
     não tem uma; CRM sempre).
  6. **Legado**: paciente antigo com convênio e sem plano aparece com "Plano não
     cadastrado" (cinza); "Editar" abre o formulário com uma linha vazia.
  7. **Celular** (~360px): a lista vira blocos (nome + Editar, plano embaixo), as linhas
     do plano empilham, nada rola de lado; a faixa do menu rola sozinha com os seis itens.
  8. **Recepção sem acesso**: logado como recepção, o menu não mostra "Cadastro"; digitar
     `/klini/pacientes` ou `/sulamerica/pacientes` leva ao painel.

- **Substituir guias: roteiro manual de navegador** (nada disto foi feito; sem navegador
  nesta sessão). Como admin, em `/klini/requisicoes/nova`, com um paciente que tenha a
  requisição A com Fono + TO e atendimentos lançados nas duas:
  1. **Caixinha**: a seção "3. Guias antigas" mostra a caixinha **desmarcada**, o rótulo
     "Substituir guias da mesma terapia" e o texto de apoio. Tab chega nela, Espaço marca;
     clicar no rótulo também marca.
  2. **Desmarcada não apaga**: enviar B só com Fono, sem marcar. Toast de sempre; no painel,
     Fono aparece em A e em B, com os atendimentos de A.
  3. **Marcada sem terapia em comum**: marcar e enviar C só com uma terapia que o paciente
     não tem. Nenhum diálogo; toast de sempre; nada some.
  4. **Diálogo mostra o que apaga**: marcar e enviar D só com Fono. O botão mostra
     "Verificando..." e abre o diálogo listando "Fono (requisição A, N atendimentos)" (e B,
     se o passo 2 foi feito), com "Cancelar" e "Substituir e apagar".
  5. **Cancelar não apaga**: Cancelar (e, numa segunda vez, Esc). Nada gravado; o formulário
     continua preenchido e a caixinha marcada.
  6. **Confirmar apaga**: repetir e confirmar. Toast "Requisição D lançada. Substituído:
     Fono (requisição A, N atendimentos apagados)…"; no painel A fica só com TO (com os
     atendimentos dela) e D tem Fono com saldo cheio e "Solicitada"; a caixinha volta
     desmarcada.
  7. **Requisição vazia some**: com um paciente cuja requisição E só tem Fono, substituir
     Fono numa F. A descrição do toast diz que E ficou sem guias e foi apagada; E não
     aparece mais no painel.
  8. **Tela estreita (390px)**: rótulo e texto de apoio quebram sem rolagem lateral; o
     diálogo cabe, com a lista quebrando nomes longos.
  9. **Recepção**: logado como recepção, `/klini/requisicoes/nova` pela barra cai em
     `/klini/dashboard`, sem a tela abrir.

- **Migration `20261028140000_nome_do_medico_sulamerica` a aplicar no Supabase ANTES do
  deploy.** Aditiva (coluna NULL + CHECK que NULL passa; nenhuma linha reescrita), então a
  ordem segura é **migration antes do código**: o código antigo não lê nem grava
  `nome_medico`; o código novo lê e grava, e sem a coluna quebra a aba Encaminhamentos
  **e** o painel da SulAmérica (a listagem lê `a.nome_medico`). Conferir antes que o
  `vigia_app` tem grant de tabela (não por coluna) em `autorizacao_sulamerica`. Depois:
  `SELECT count(*), count(nome_medico) FROM autorizacao_sulamerica;` — o segundo deve ser 0.
  Ela depende de `20261028120000_carteirinha_e_crm_do_paciente` (pendência abaixo), que
  também precisa estar aplicada.
- **Preencher o legado da SulAmérica (as ~50 autorizações de antes de 28/10/2026):**
  carteirinha, CRM e **nome do médico**. Pela aba `/sulamerica/encaminhamentos`, com o
  mesmo nome **e a mesma data e prazo** exibidos (data ou prazo diferente substitui a
  autorização e muda o vencimento); nesse reenvio o nome do médico e o CRM são exigidos, e
  a carteirinha também se o paciente ainda não tiver uma. Conferir quantos faltam:
  `SELECT count(*) FROM autorizacao_sulamerica a JOIN paciente p ON p.id = a.paciente_id
  WHERE a.nome_medico IS NULL OR p.numero_carteirinha IS NULL OR p.crm_medico IS NULL;`.
- **Paciente nos dois convênios compartilha carteirinha e CRM** (limitação registrada na
  regra 20). Se a clínica precisar de carteirinha/CRM por convênio, é mudança de modelo
  (colunas na autorização/encaminhamento, ou tabela por convênio), não ajuste.
- **Encaminhamentos da SulAmérica: roteiro manual de navegador** (nada disto foi feito;
  sem navegador nesta sessão). Como admin, em `/sulamerica/encaminhamentos`:
  1. **Paciente novo com os seis campos**: nome inédito, data, prazo 6 meses, carteirinha
     `ABC 123 45`, CRM `123.456`, médico `  Dr.  João D'Ávila-Silva `. Toast "Encaminhamento
     cadastrado para …" com o vencimento; a linha mostra `ABC12345`, `123456` e
     `Dr. João D'Ávila-Silva`. Paciente, carteirinha, CRM e médico voltam vazios, a data
     volta para hoje, o prazo volta para "Escolha o prazo" e o foco volta ao nome.
  2. **Reenvio com carteirinha em branco**: mesmo nome (rótulo "(opcional)" e placeholder
     "Manter a cadastrada"), CRM e médico novos. Toast "atualizado", uma linha só,
     carteirinha intacta, CRM e médico novos.
  3. **Nome do médico vazio recusado**: qualquer paciente com o médico em branco (e depois
     com 2 letras, e só com números) → mensagem do nome do médico, campo marcado, nada
     gravado, digitação mantida.
  4. **Carteirinha repetida de outro paciente**: um nome novo com a carteirinha de um
     paciente da Klini (inclusive em minúsculas) → "Esta carteirinha já está cadastrada
     para <nome>.", campo da carteirinha marcado; recarregar e conferir que o nome novo
     **não** virou paciente.
  5. **Copiar**: em cada linha, clicar o ícone ao lado da carteirinha e colar num editor
     (só o número); idem o CRM. O ícone vira check por ~2 s; leitor de tela anuncia
     "Carteirinha de <nome> copiada." sem ler o número. Conferir que o médico não tem botão.
  6. **Paciente antigo**: um dos legados mostra "— falta preencher" em carteirinha, CRM e
     médico, botões de copiar desabilitados e esmaecidos, e a dica acima da lista.
  7. **Celular (390px)**: a lista vira blocos ("Carteirinha:", "CRM:", "Médico:"), o
     formulário empilha, a página não rola de lado. Entre `sm` e `lg` o nome ocupa a linha
     de cima com data e prazo embaixo; em `lg`, nome/data/prazo numa linha e
     carteirinha/CRM/médico/botão na outra.
  8. **Recepção sem acesso**: logado como recepção, `/sulamerica/encaminhamentos` (digitado
     na barra) cai em `/klini/dashboard`; o menu não mostra item da SulAmérica.
  9. **Menus separados**: como admin, o menu em `/sulamerica/*` mostra só "Painel" e
     "Encaminhamentos" (da SulAmérica), sem nenhum item da Klini; em `/klini/*`, nenhum da
     SulAmérica. "Trocar convênio" continua no cabeçalho das duas páginas da SulAmérica.
  10. **Painel**: `/sulamerica/dashboard` sem formulário e sem link de texto no parágrafo.
      O botão "Registrar Encaminhamento" (com "+") fica à direita do título "Registradas";
      a 390px desce para linha própria na largura útil, sem rolagem lateral. Clicar (e
      Tab + Enter, com o anel de foco visível) leva a `/sulamerica/encaminhamentos`.
      Excluir autorização continua funcionando.
- **Preencher carteirinha/CRM do legado.** Pacientes de antes de 28/10/2026 continuam
  recebendo requisição sem esses dados (decisão deliberada, regra 21). O preenchimento é
  pelo próprio cadastro de encaminhamento (mesmo nome **e mesma data**, ver a dica da
  lista). Conferir quantos faltam:
  `SELECT count(*) FROM paciente WHERE numero_carteirinha IS NULL OR crm_medico IS NULL;`.
- **Paciente só pelo encaminhamento: roteiro manual de navegador** (nada disto foi feito;
  nenhuma sessão teve navegador). Como admin:
  1. **Nome inexistente recusado**: em `/klini/requisicoes/nova`, digitar um nome que não
     é de ninguém, escolher terapia e enviar. A mensagem "Paciente não cadastrado.
     Cadastre primeiro o encaminhamento em Encaminhamentos." aparece **logo abaixo do
     campo de paciente** (campo marcado como inválido), não no fim do formulário; o que
     foi digitado continua lá. Recarregar e conferir em Encaminhamentos/SulAmérica que o
     nome **não** virou paciente.
  2. **Nome existente com encaminhamento aceito**: escolher um nome da sugestão, digitando
     com outra caixa e espaços nas pontas. Toast "Requisição criada para <nome gravado>";
     no painel, a requisição está no paciente certo, sem paciente duplicado.
  3. **Sugestões só de quem tem encaminhamento**: digitar as primeiras letras e conferir
     que um paciente que só existe pela SulAmérica (ou um do seed sem encaminhamento)
     **não** aparece; em "Lançar atendimento" e na SulAmérica as sugestões continuam as
     de antes.
  4. **Paciente existente sem encaminhamento**: digitar o nome de um paciente criado só
     pela SulAmérica → "Paciente sem encaminhamento cadastrado. …", junto ao campo.
  5. **Fluxo encaminhamento → requisição**: clicar o link "Cadastrar encaminhamento" (vai a
     `/klini/encaminhamentos`), cadastrar nome novo + data + carteirinha + CRM, voltar a
     "Nova requisição": o nome aparece na sugestão e a requisição passa.
  6. **Legado**: um paciente antigo com encaminhamento e "falta preencher" na lista
     recebe requisição normalmente.
  7. Conferir o link discreto (sublinhado, cor do texto de apoio) e o erro junto ao campo
     a 390px.

- **Migration `20261028120000_carteirinha_e_crm_do_paciente` a aplicar no Supabase.** Ela
  é aditiva, então a ordem segura é **migration antes do código**: o código antigo não lê
  nem grava as colunas novas e continua funcionando com elas presentes. O inverso
  (código novo antes) quebra cadastro **e** listagem de encaminhamentos. Antes de aplicar,
  conferir que o `vigia_app` tem grant **de tabela** (não por coluna) em `paciente` —
  grant por coluna não cobriria colunas novas. Depois:
  `SELECT count(*) FILTER (WHERE numero_carteirinha IS NOT NULL) FROM paciente;` deve dar 0.
- **Carteirinha/CRM: roteiro de teste manual no navegador** (nenhuma sessão teve
  navegador; nada disto foi feito ainda). Em `/klini/encaminhamentos`, como admin:
  1. **Paciente novo**: nome inédito, data, carteirinha com espaços colados
     (`ABC 123 45`) e CRM (`123.456`). Toast "cadastrado"; a linha mostra `ABC12345` e
     `123456`; nome, carteirinha e CRM voltam vazios, a data volta para hoje e o foco
     volta ao nome.
  2. **Reenvio com CRM diferente e carteirinha em branco**: mesmo nome (o rótulo da
     carteirinha mostra "(opcional)" e o placeholder "Manter a cadastrada"), CRM novo.
     Toast "atualizado", uma linha só, carteirinha intacta, CRM novo.
  3. **Carteirinha repetida de outro paciente**: outro nome com a carteirinha do passo 1
     (inclusive em minúsculas). Erro "Esta carteirinha já está cadastrada para <nome>."
     junto ao formulário, campo da carteirinha marcado, nada gravado, digitação mantida.
  4. **Paciente antigo sem carteirinha** (algum de antes de 28/10/2026): nome dele com a
     carteirinha em branco → "Este paciente ainda não tem carteirinha cadastrada.
     Informe o número."
  5. **Copiar**: em cada linha, clicar o ícone de copiar ao lado da carteirinha (passar
     o mouse mostra "Copiar carteirinha de <nome>"), colar num campo de texto qualquer (a
     busca da própria tela serve) e conferir que veio **só** o número, sem rótulo nem
     espaço; repetir com o CRM. Conferir que o ícone vira check por ~2s e volta, e (com leitor de tela, se possível) o anúncio
     "Carteirinha de <nome> copiada.".
  6. **Paciente antigo na lista**: "— falta preencher" nas duas colunas, botões
     desabilitados, dica acima da lista. Registrar de novo com mesmo nome, mesma data,
     carteirinha e CRM: a linha fica completa e a dica some se era o último.
  7. **Celular (390px)**: a lista vira blocos com "Carteirinha:" / "CRM:", número e
     ícone de copiar fácil de tocar (36×36px), com carteirinha longa quebrando sem
     empurrar o ícone para fora; nada rola de lado. Conferir
     também ~700px (formulário em duas linhas, lista em blocos) e ≥1024px (tabela).
  8. **Plano B**: abrir o sistema por `http://<ip-da-máquina>:3000` (fora de contexto
     seguro) e copiar — deve funcionar pelo `execCommand`; se não, aparece o toast de
     falha e o número continua selecionável na tela.
  9. **Recepção**: logar com a conta de recepção e abrir `/klini/encaminhamentos` pela
     URL — deve cair em `/klini/dashboard` sem a tela abrir; o menu não mostra
     "Encaminhamentos".
  10. **Painel** (regressão do botão movido): o copiar do cabeçalho do paciente e o
      "Copiar selecionados" continuam funcionando como antes.
- **Formulário não pré-preenche carteirinha/CRM** de paciente que já existe: quem
  reenvia precisa redigitar os dois. Não foi pedido.

- **Migration `20261026130000_situacao_da_requisicao` a aplicar no Supabase — e a ordem
  em relação ao deploy importa.** Nenhuma das duas ordens é sem janela:
  - código novo **antes** da migration quebra painel, lançamento e cadastro (todos leem
    ou gravam `situacao`);
  - migration **antes** do código novo deixa o código antigo funcionando para leitura e
    lançamento, e quebra **só** "Nova requisição" (o `create` antigo não informa a
    situação, e a coluna não tem default) até o deploy subir.
  Por isso: **(1)** merge; **(2)** `npm run db:migrate:deploy` contra o Supabase —
  aplica, em ordem, a `20261026120000_guia_unica_por_terapia_na_requisicao` (ainda
  pendente lá; rodar antes a consulta de duplicatas da pendência abaixo) e esta; **(3)**
  deploy na Vercel logo em seguida; não cadastrar requisição entre (2) e (3). Toda
  requisição de produção sai `aprovada`. Depois, conferir no Supabase:
  `SELECT situacao, count(*) FROM requisicao GROUP BY situacao;`.
- **Situação da requisição: validação manual no navegador.** Com as duas contas: como
  admin, criar uma requisição e vê-la "Solicitada" no painel (abrir o paciente); como
  recepção, abrir "Lançar atendimento", conferir a guia desabilitada com "Aguardando
  aprovação (requisição N)", "Marcar todas" ignorando-a e, se for a única, o botão
  desabilitado com a explicação; confirmar que a recepção não vê o botão no painel; como
  admin, "Aprovar" (toast) e lançar com sucesso; "Voltar para solicitada" e conferir o
  bloqueio de novo. Conferir também a lista móvel (abaixo de `md`) e o indicador
  "Solicitada" no cabeçalho do paciente recolhido, sobretudo num nome longo a 390px. O fluxo de dados já
  foi exercitado por HTTP; falta clique, foco, toast e layout.

- **Migration `20261026120000_guia_unica_por_terapia_na_requisicao` a aplicar no
  Supabase depois do merge** de `feat/terapia-repetida-atualiza-guia`. Antes, rodar lá
  `SELECT requisicao_id, terapia_id, count(*) FROM requisicao_terapia GROUP BY
  requisicao_id, terapia_id HAVING count(*) > 1;` — se voltar linha, a migration aborta de
  propósito e as duplicatas precisam de decisão manual (cada guia pode ter atendimentos).

- **Fase D: validação local interativa antes de merge.** Como admin, abrir SulAmérica
  pela raiz, cadastrar cada prazo e conferir vencimento, substituir cadastro, filtrar
  nome, cancelar/confirmar exclusão e conferir paciente preservado no autocomplete.
  Conferir reset do prazo para vazio, foco no nome, toasts e tabela/lista móvel.
  Usar “Trocar convênio”. Como recepção, conferir menu e URL direta bloqueada.
  As rotas/actions e os cálculos já passaram por teste automatizado e HTTP; falta o clique.

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
- **(Conferido em 26/10/2026: no banco local só existe a conta `admin`, id 1 — as duas
  contas abaixo já não existem. Item mantido como histórico.)** **Duas contas de teste
  ficaram no banco de desenvolvimento, com senhas conhecidas por quem leu esta sessão.** `recepcao_teste` (id 44, papel `recepcao`) e `codex_teste` (id
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
     encaminhamentos**, escolher uma terapia e enviar. Confirmar a mensagem "Paciente não
     cadastrado. Cadastre primeiro o encaminhamento em Encaminhamentos." (desde
     28/10/2026; antes era a de "sem encaminhamento") e que o formulário continua na tela
     com o que foi digitado.
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
  5. Repetir o envio com uma terapia **que já está na requisição**, com outra quantidade e
     outra validade: **não** pode aparecer segunda linha — a linha existente passa a
     mostrar a quantidade e a validade novas, o atendimento lançado no passo 4 continua lá
     e o saldo é refeito sobre a quantidade nova. O toast diz "1 terapia atualizada na
     requisição <número> de <paciente>." (Revertido em 26/10/2026: antes este passo
     pedia uma segunda linha.)
  6. No mesmo envio, uma terapia repetida e uma nova: toast "1 terapia adicionada e 1
     atualizada …". E duas linhas com a mesma terapia no formulário: erro na segunda linha,
     nada gravado.
- **O banco de desenvolvimento local ficou com cinco encaminhamentos de demonstração**
  ("Zoe Vencida Manual", "Bruno Este Mes Manual", "Carla Fim Deste Mes Manual", "Diego A
  Vencer Manual", "Elisa Longe Manual"), um em cada caso da classificação, criados para a
  verificação de 09/09/2026 e deixados de pé justamente para esse teste manual de
  navegador. As datas foram miradas a partir do `CURRENT_DATE`, então **elas envelhecem**:
  daqui a um mês os status já não são os que os nomes dizem. Apagar quando o roteiro
  acima for cumprido; nada disso existe em produção.

# klini — Contexto do domínio

Sistema de controle de autorizações de terapia de uma clínica. Não tem múltiplos perfis:
existe apenas "usuário autenticado e ativo" ou "não autenticado".

## Entidades

- **paciente**: id, nome (texto, indexado). Get-or-create por nome, comparação
  case-insensitive, nome sempre trimado antes de salvar/buscar.
- **usuario**: id, username (único), password_hash (bcrypt), ativo (bool, default true).
- **terapia**: id, nome (único), codigo_tiss (texto).
- **requisicao**: id, numero_requisicao (texto, indexado), paciente_id (FK).
- **requisicao_terapia** ("guia"): id, qtd_autorizada (int), validade (date, opcional),
  requisicao_id (FK), terapia_id (FK).
- **atendimento**: id, data_atendimento (date), creditos_consumidos (int, default 1),
  observacao (texto, opcional), requisicao_terapia_id (FK, ON DELETE CASCADE).

## Campos calculados (guia)

- `qtd_utilizada` = soma de `creditos_consumidos` de todos os atendimentos da guia.
- `saldo_restante` = `qtd_autorizada - qtd_utilizada`.
- `creditos_por_sessao` = `qtd_autorizada / 4` (ou 0 se `qtd_autorizada` for vazio/0).
- `status_alerta`:
  - `"Esgotada"` se `qtd_autorizada` vazio/0 OU `saldo_restante <= 0`.
  - `"Renovar"` se `saldo_restante <= qtd_autorizada / 4` OU validade a <= 7 dias.
  - senão `"Regular"`.

Calcule isso preferencialmente em uma **view SQL** (`requisicao_terapia_saldo`) para evitar
divergência entre lugares que leem o saldo — não replique a fórmula em múltiplos arquivos
TypeScript.

## Regras de negócio obrigatórias

1. Login exige `usuario.ativo = true` e senha bcrypt válida. Falha → formulário com erro,
   HTTP 400.
2. Parâmetro `next` do login só é aceito se começar com `/` e não com `//` (evita redirect
   externo).
3. Cookie de sessão: `secure=true` apenas quando `NODE_ENV=production`; expiração
   configurável, padrão 8 horas.
4. Criar requisição: get-or-create do paciente + criar `requisicao` + criar N linhas de
   `requisicao_terapia`, tudo em **uma transação atômica** (não pode sobrar paciente órfão
   se a criação da requisição falhar).
5. Só terapias com `saldo_restante > 0` aparecem na tela de lançar atendimento.
6. Lançamento de atendimento em lote:
   - pelo menos 1 terapia selecionada;
   - não pode repetir o mesmo `requisicao_terapia_id` no mesmo lote;
   - `creditos_consumidos` deve ser inteiro **> 0**;
   - falha se a guia não existe;
   - falha se o saldo já está esgotado ou se os créditos pedidos excedem o saldo
     disponível;
   - use `SELECT ... FOR UPDATE` (transação) para travar a guia e evitar corrida quando
     dois lançamentos simultâneos disputam o mesmo saldo.
7. Edição de atendimento: permite `creditos_consumidos = 0`, rejeita negativo. Recalcula a
   soma dos **outros** atendimentos da mesma guia e rejeita se o total após a edição
   exceder `qtd_autorizada`. (Sim, a regra de edição é mais permissiva que a de
   lançamento — isso é intencional, mantido do sistema original.)
8. Exclusão de guia: **diferente do sistema antigo**, aqui a restrição deve valer também
   no backend, não só escondida na UI — bloqueie exclusão de guia com status `"Regular"`
   no servidor (ver "Decisões assumidas" abaixo).
9. Exclusão de guia deve apagar os atendimentos filhos (via `ON DELETE CASCADE` no banco).
10. Relatório semanal: agrupa guias por paciente, mantém só pacientes com pelo menos uma
    guia `Renovar` ou `Esgotada`. Se a lista final estiver vazia, não envia e-mail.

## Decisões assumidas (o relatório de auditoria deixou como perguntas em aberto — revise se divergir do que você quer)

- `paciente.nome`: **único case-insensitive** no banco (índice `UNIQUE` sobre
  `lower(nome)`), para eliminar duplicados por corrida — o sistema antigo não tinha isso.
- `numero_requisicao`: único **por paciente** (não globalmente único), permitindo reuso de
  numeração entre pacientes diferentes mas não duplicata para o mesmo paciente.
- `qtd_autorizada`: deve ser **> 0** na criação da guia (rejeitar 0 no formulário); guias
  existentes com saldo zerado continuam caindo em `"Esgotada"` normalmente.
- Exclusão de guia `"Regular"` bloqueada no backend (ver regra 8 acima), não só na UI.
- Edição de atendimento para 0 créditos continua permitida (mantido do sistema original).

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

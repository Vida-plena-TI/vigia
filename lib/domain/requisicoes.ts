/**
 * Cadastro de nova requisição (regra 5 do CONTEXT.md).
 *
 * Tudo — busca do paciente, resolução do número e as N linhas de
 * `requisicao_terapia` — acontece em **uma** transação. Se qualquer linha da
 * lista falhar, a transação inteira volta atrás.
 *
 * **Esta tela não cria paciente** (desde 28/10/2026). Paciente só nasce pelo
 * cadastro de encaminhamento; aqui o nome é procurado e, se não for de
 * ninguém, a requisição é recusada sem gravar nada.
 *
 * Uma requisição é uma **pasta numerada**, não um evento: terapias entram nela
 * ao longo do tempo, e não só no minuto em que ela nasce. Por isso submeter um
 * `numero_requisicao` que aquele paciente já tem **acrescenta** as terapias à
 * requisição existente em vez de recusar o cadastro. A unique
 * `(paciente_id, numero_requisicao)` continua no banco, intacta — o que mudou
 * foi o que se faz diante dela: antes, rejeitar; agora, anexar. Ver
 * {@link criarNaTransacao}.
 *
 * Dentro da pasta, cada terapia tem **uma** guia (UNIQUE
 * `(requisicao_id, terapia_id)`, desde 26/10/2026). Uma terapia que a
 * requisição já tem não vira segunda guia: o envio **atualiza** `qtd_autorizada`
 * e `validade` da guia existente, com UPDATE — nunca DELETE + INSERT, que
 * levaria os atendimentos da guia junto pelo cascade.
 *
 * A busca do paciente mora em `lib/domain/pacientes.ts`, ao lado do
 * get-or-create do encaminhamento e com a mesma comparação de nome
 * (`lower(nome) = lower($1)`, a expressão do índice `UNIQUE (lower(nome))`).
 *
 * Desde 09/09/2026 a transação também é o lugar onde a regra 15 é aplicada:
 * **não se cria requisição para paciente sem encaminhamento cadastrado**. Ver
 * {@link criarNaTransacao} para o porquê de a checagem morar dentro da
 * transação, e não antes dela.
 *
 * Desde 29/10/2026 o envio pode **substituir** (caixinha do formulário): as
 * guias da mesma terapia em outras requisições do paciente são apagadas, com
 * os atendimentos, na mesma transação — ver {@link substituirGuiasNaTransacao}
 * e a prévia {@link previsaoDeSubstituicao}.
 */
import { getPrismaClient } from "@/lib/db";
import { OPCOES_DE_TRANSACAO } from "@/lib/db/transacao";
import type { Prisma } from "@/lib/generated/prisma/client";

import { excluirGuiaNaTransacao } from "./guias";
import { buscarPacientePorNome } from "./pacientes";
import {
  SITUACAO_INICIAL,
  comoSituacao,
  ehSituacaoValida,
  type SituacaoDeRequisicao,
} from "./situacao-requisicao";
import {
  ERRO_NUMERO_OBRIGATORIO,
  ERRO_PACIENTE_NAO_CADASTRADO,
  ERRO_PACIENTE_OBRIGATORIO,
  ERRO_QTD_INVALIDA,
  ERRO_REQUISICAO_ID_INVALIDO,
  ERRO_REQUISICAO_INEXISTENTE,
  ERRO_SEM_ENCAMINHAMENTO,
  ERRO_SITUACAO_INVALIDA,
  ERRO_SEM_TERAPIA,
  ERRO_TERAPIA_INEXISTENTE,
  ERRO_TERAPIA_OBRIGATORIA,
  ERRO_TERAPIA_REPETIDA_NO_ENVIO,
  ERRO_VALIDADE_INVALIDA,
  erroCorridaNaGuia,
  erroCorridaNaRequisicao,
} from "./requisicoes-mensagens";

/**
 * Reexportadas para quem já consome o domínio não precisar saber que as
 * mensagens moram em um módulo à parte (elas moram lá só para o formulário
 * poder importá-las sem arrastar o Prisma para o cliente).
 */
export * from "./requisicoes-mensagens";

/** Uma linha "terapia + quantidade + validade" do formulário. */
export type LinhaDeTerapia = {
  terapiaId: number;
  qtdAutorizada: number;
  /** "AAAA-MM-DD" ou `null`. Opcional — nem toda guia tem validade. */
  validade: string | null;
};

/** O que o formulário manda para a action, já como tipos, não como texto. */
export type EntradaNovaRequisicao = {
  pacienteNome: string;
  numeroRequisicao: string;
  linhas: LinhaDeTerapia[];
  /**
   * Caixinha "Substituir guias da mesma terapia" (desde 29/10/2026).
   *
   * `true`: para cada terapia do envio, as guias do **mesmo paciente** com a
   * **mesma terapia** em **outras** requisições são apagadas, com os
   * atendimentos delas (cascade), e a requisição antiga que ficar sem guia
   * nenhuma some junto. Ver {@link substituirGuiasNaTransacao}.
   *
   * Ausente ou `false`: o comportamento de sempre — as guias coexistem. É o
   * padrão porque apagar atendimento não tem volta.
   */
  substituir?: boolean;
};

/**
 * Uma guia que a substituição apaga (ou apagaria, na prévia).
 *
 * `atendimentos` é quantos atendimentos estavam pendurados nela, contados
 * **depois** do `FOR UPDATE` dentro da transação — ou no instante da leitura,
 * na prévia.
 */
export type GuiaSubstituida = {
  guiaId: number;
  terapiaId: number;
  terapiaNome: string;
  requisicaoId: number;
  numeroRequisicao: string;
  atendimentos: number;
};

/** Uma terapia como o `select` do formulário precisa dela. */
export type TerapiaParaEscolha = {
  id: number;
  nome: string;
  codigoTiss: string;
};

export type ResultadoCriacao =
  | {
      ok: true;
      requisicaoId: number;
      numeroRequisicao: string;
      pacienteNome: string;
      /**
       * `true` quando nasceu uma linha de `requisicao`; `false` quando as
       * terapias foram acrescentadas a uma requisição que já existia.
       *
       * É o que separa "Requisição criada para X" de "N terapias adicionadas à
       * requisição Y de X" na confirmação — ver `mensagemDeCriacao`.
       */
      requisicaoCriada: boolean;
      /** Quantas linhas novas de `requisicao_terapia` este envio inseriu. */
      terapiasAdicionadas: number;
      /**
       * Quantas guias que a requisição já tinha este envio atualizou
       * (`qtd_autorizada` e `validade`), por trazer uma terapia que já estava
       * nela.
       *
       * Somado com `terapiasAdicionadas` dá sempre o tamanho da lista que veio
       * do formulário. É sempre 0 quando `requisicaoCriada` — numa pasta que
       * acabou de nascer não há guia anterior a atualizar.
       */
      terapiasAtualizadas: number;
      /**
       * Guias de outras requisições apagadas pela substituição, em ordem de
       * id. Sempre vazia quando `substituir` não veio marcado.
       */
      substituidas: GuiaSubstituida[];
      /**
       * Números das requisições antigas apagadas por terem ficado sem guia
       * nenhuma depois da substituição.
       */
      requisicoesApagadas: string[];
    }
  | {
      ok: false;
      erro: string;
      /**
       * Índice (base 0) da linha de terapia culpada, quando o erro é de uma
       * linha específica. Serve para o formulário marcar o campo certo em vez
       * de mostrar um erro solto no topo.
       */
      linha?: number;
    };

/**
 * Erro de negócio lançado de dentro da transação.
 *
 * Precisa ser lançado (e não devolvido) porque é o `throw` que faz o Postgres
 * desfazer o que já foi escrito — as guias atualizadas antes de uma linha
 * ruim, por exemplo. Quem chama converte de volta para `{ ok: false }`.
 */
class ErroDeNegocio extends Error {
  constructor(
    readonly erro: string,
    readonly linha?: number,
  ) {
    super(erro);
    this.name = "ErroDeNegocio";
  }
}

/** Uma data "AAAA-MM-DD" que existe de verdade no calendário. */
function validadeValida(validade: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validade)) {
    return false;
  }

  // `new Date` normaliza silenciosamente ("2026-02-31" vira 03/03). Comparar o
  // ISO de volta é o que rejeita a data que não existe.
  const data = new Date(`${validade}T00:00:00.000Z`);

  return (
    !Number.isNaN(data.getTime()) &&
    data.toISOString().slice(0, 10) === validade
  );
}

/**
 * Validação que não precisa do banco.
 *
 * Roda antes de abrir a transação: não vale gastar conexão com um formulário
 * que já dá para recusar. É a mesma checagem que o cliente faz — o cliente é
 * conveniência, esta aqui é a que vale, porque a action é alcançável por POST
 * direto.
 */
export function validarEntrada(
  entrada: EntradaNovaRequisicao,
): { ok: true } | { ok: false; erro: string; linha?: number } {
  if (!entrada.pacienteNome.trim()) {
    return { ok: false, erro: ERRO_PACIENTE_OBRIGATORIO };
  }

  if (!entrada.numeroRequisicao.trim()) {
    return { ok: false, erro: ERRO_NUMERO_OBRIGATORIO };
  }

  if (entrada.linhas.length === 0) {
    return { ok: false, erro: ERRO_SEM_TERAPIA };
  }

  for (const [indice, linha] of entrada.linhas.entries()) {
    if (!Number.isInteger(linha.terapiaId) || linha.terapiaId <= 0) {
      return { ok: false, erro: ERRO_TERAPIA_OBRIGATORIA, linha: indice };
    }

    // A CHECK `requisicao_terapia_qtd_autorizada_positiva` é o backstop no
    // banco; aqui a rejeição vira mensagem em vez de exceção.
    if (!Number.isInteger(linha.qtdAutorizada) || linha.qtdAutorizada <= 0) {
      return { ok: false, erro: ERRO_QTD_INVALIDA, linha: indice };
    }

    if (linha.validade !== null && !validadeValida(linha.validade)) {
      return { ok: false, erro: ERRO_VALIDADE_INVALIDA, linha: indice };
    }

    // Uma guia por terapia (UNIQUE `(requisicao_id, terapia_id)`): duas
    // linhas da mesma terapia no mesmo envio não têm leitura certa. Aponta a
    // segunda, que é a que sobra.
    if (
      entrada.linhas
        .slice(0, indice)
        .some((anterior) => anterior.terapiaId === linha.terapiaId)
    ) {
      return { ok: false, erro: ERRO_TERAPIA_REPETIDA_NO_ENVIO, linha: indice };
    }
  }

  return { ok: true };
}

/**
 * A criação em si, já dentro de uma transação.
 *
 * Dois desfechos possíveis, decididos pela existência de uma linha de
 * `requisicao` para `(paciente_id, numero_requisicao)`: criar a requisição com
 * as terapias penduradas nela, ou levar as terapias à requisição que já
 * estava lá — inserindo as que ela ainda não tem e atualizando a guia das que
 * ela já tem. Os dois são sucesso; `requisicaoCriada` diz qual aconteceu, e
 * `terapiasAdicionadas` / `terapiasAtualizadas` contam o segundo.
 *
 * Recebe o cliente da transação (em vez de abrir a própria) pelo mesmo motivo
 * de `excluirGuiaNaTransacao`: é o que deixa o teste de integração rodar tudo
 * dentro de uma transação que sofre rollback.
 *
 * Lança {@link ErroDeNegocio} em vez de devolver `{ ok: false }` — devolver
 * faria o Prisma commitar o que já tivesse sido escrito.
 */
async function criarNaTransacao(
  tx: Prisma.TransactionClient,
  entrada: EntradaNovaRequisicao,
): Promise<Extract<ResultadoCriacao, { ok: true }>> {
  const pacienteNome = entrada.pacienteNome.trim();
  const numeroRequisicao = entrada.numeroRequisicao.trim();

  // Só procura, nunca cria: paciente nasce pelo cadastro de encaminhamento.
  // A busca trava a linha com `FOR KEY SHARE` (ver `buscarPacientePorNome`),
  // o que impede uma exclusão de paciente de apagá-lo — e ao encaminhamento
  // junto — entre as checagens abaixo e o INSERT da requisição.
  const paciente = await buscarPacientePorNome(tx, pacienteNome);

  if (!paciente) {
    throw new ErroDeNegocio(ERRO_PACIENTE_NAO_CADASTRADO);
  }

  // Regra 15: sem encaminhamento cadastrado não há requisição.
  //
  // Mora aqui dentro porque é a mesma transação que travou o paciente: o
  // encaminhamento só some pela exclusão do paciente, que o lock acima segura.
  // Este caso — paciente existe, encaminhamento não — sobra para cadastros
  // anteriores à regra e para pacientes criados pela SulAmérica.
  //
  // A pergunta é de **existência**, não de validade: qualquer linha serve,
  // inclusive uma cujo `data_vencimento` já passou. É por isso que a consulta é
  // à tabela `encaminhamento` e não à view `encaminhamento_status` — a view
  // classifica o vencimento, e classificar não é o que está sendo perguntado.
  const encaminhamento = await tx.encaminhamento.findFirst({
    where: { pacienteId: paciente.id },
    select: { id: true },
  });

  if (!encaminhamento) {
    throw new ErroDeNegocio(ERRO_SEM_ENCAMINHAMENTO);
  }

  // A requisição já existe para este paciente? A resposta não recusa nada —
  // ela escolhe entre os dois desfechos, e é também o que permite dizer *qual*
  // deles aconteceu (mesma técnica do `FOR UPDATE` de `gravarNaTransacao` em
  // `encaminhamentos.ts`: olhar antes de gravar).
  //
  // O filtro é `pacienteId` **mais** `numeroRequisicao`, nunca o número
  // sozinho: a unicidade é por paciente, e o mesmo número na pasta de outra
  // pessoa é uma requisição diferente, que não pode receber estas terapias.
  //
  // Sobra uma janela de corrida quando a requisição ainda não existe: outro
  // cadastro pode criá-la entre este SELECT e o INSERT lá embaixo. Quem fecha
  // a janela é a unique do banco, traduzida em `criarRequisicao` num pedido de
  // reenvio — reenviar cai neste mesmo SELECT, agora enxergando a linha, e
  // acrescenta as terapias.
  const requisicaoExistente = await tx.requisicao.findFirst({
    where: { pacienteId: paciente.id, numeroRequisicao },
    select: { id: true },
  });

  // As terapias são conferidas contra o banco antes do insert. Sem isso um id
  // inventado viraria violação de FK — erro cru de driver, não mensagem.
  const idsPedidos = entrada.linhas.map((linha) => linha.terapiaId);

  const existentes = await tx.terapia.findMany({
    where: { id: { in: idsPedidos } },
    select: { id: true },
  });

  const idsExistentes = new Set(existentes.map((terapia) => terapia.id));
  const indiceRuim = idsPedidos.findIndex((id) => !idsExistentes.has(id));

  if (indiceRuim !== -1) {
    throw new ErroDeNegocio(ERRO_TERAPIA_INEXISTENTE, indiceRuim);
  }

  // Caixinha marcada: as guias da mesma terapia em **outras** requisições
  // deste paciente saem antes de a guia nova entrar. Mesma transação: se
  // qualquer passo daqui para baixo lançar, nada foi apagado. A guia da
  // requisição de mesmo número fica de fora — segue o caminho de UPDATE do
  // desfecho 2, como sempre.
  const { substituidas, requisicoesApagadas } = entrada.substituir
    ? await substituirGuiasNaTransacao(
        tx,
        paciente.id,
        numeroRequisicao,
        idsPedidos,
      )
    : { substituidas: [], requisicoesApagadas: [] };

  // As mesmas linhas servem aos dois desfechos: a `validade` é atributo de
  // cada `requisicao_terapia`, não da requisição. Uma terapia acrescentada hoje
  // a uma pasta antiga carrega a validade dela própria, sem tocar nas guias
  // das outras terapias que já estavam lá.
  const guias = entrada.linhas.map((linha) => ({
    terapiaId: linha.terapiaId,
    qtdAutorizada: linha.qtdAutorizada,
    // Coluna DATE: gravamos a meia-noite UTC do dia informado, para o dia
    // gravado não depender do fuso de quem submeteu o formulário.
    validade: linha.validade
      ? new Date(`${linha.validade}T00:00:00.000Z`)
      : null,
  }));

  // Desfecho 2: a pasta já existe. Nada de `requisicao.create` — seria
  // exatamente o INSERT que a unique recusa. Cada terapia do envio cai num de
  // dois casos, decididos pelo que a requisição já tem:
  //
  // - terapia nova na pasta -> INSERT de guia sob o `requisicao_id` existente;
  // - terapia que a pasta já tem -> UPDATE de `qtd_autorizada` e `validade` da
  //   guia que está lá (UNIQUE `(requisicao_id, terapia_id)`: segunda guia da
  //   mesma terapia não existe mais).
  //
  // **UPDATE, nunca DELETE + INSERT.** A guia é o pai dos atendimentos
  // (`ON DELETE CASCADE`): apagá-la para recriar levaria o histórico junto e
  // zeraria o saldo. Atualizando no lugar, o `id` não muda, os atendimentos
  // continuam pendurados nele, e a view recalcula o saldo com a quantidade
  // nova.
  //
  // A validade é substituída pelo que veio do formulário, inclusive `null`:
  // o campo nasce preenchido (hoje + 1 mês), então chegar vazio é alguém ter
  // apagado de propósito.
  if (requisicaoExistente) {
    const guiasDaPasta = await tx.requisicaoTerapia.findMany({
      where: {
        requisicaoId: requisicaoExistente.id,
        terapiaId: { in: idsPedidos },
      },
      select: { id: true, terapiaId: true },
    });

    const guiaPorTerapia = new Map(
      guiasDaPasta.map((guia) => [guia.terapiaId, guia.id]),
    );

    const novas = guias.filter((guia) => !guiaPorTerapia.has(guia.terapiaId));
    const repetidas = guias.filter((guia) =>
      guiaPorTerapia.has(guia.terapiaId),
    );

    for (const guia of repetidas) {
      await tx.requisicaoTerapia.update({
        where: { id: guiaPorTerapia.get(guia.terapiaId) },
        data: { qtdAutorizada: guia.qtdAutorizada, validade: guia.validade },
      });
    }

    if (novas.length > 0) {
      await tx.requisicaoTerapia.createMany({
        data: novas.map((guia) => ({
          ...guia,
          requisicaoId: requisicaoExistente.id,
        })),
      });
    }

    return {
      ok: true,
      requisicaoId: requisicaoExistente.id,
      numeroRequisicao,
      pacienteNome: paciente.nome,
      requisicaoCriada: false,
      terapiasAdicionadas: novas.length,
      terapiasAtualizadas: repetidas.length,
      substituidas,
      requisicoesApagadas,
    };
  }

  // Desfecho 1: número inédito para este paciente. Requisição e guias nascem
  // no mesmo comando aninhado, como sempre foi.
  //
  // A requisição nova nasce "solicitada" (enviada ao convênio, ainda em
  // análise) e só aceita atendimento depois que um admin a aprovar. A
  // situação vai **explícita**: a coluna não tem default. O desfecho 2, acima,
  // não toca nela — acrescentar ou atualizar terapia numa pasta que já existe
  // não muda a situação da pasta.
  const requisicao = await tx.requisicao.create({
    data: {
      numeroRequisicao,
      pacienteId: paciente.id,
      situacao: SITUACAO_INICIAL,
      guias: { create: guias },
    },
    select: { id: true },
  });

  return {
    ok: true,
    requisicaoId: requisicao.id,
    numeroRequisicao,
    pacienteNome: paciente.nome,
    requisicaoCriada: true,
    terapiasAdicionadas: guias.length,
    terapiasAtualizadas: 0,
    substituidas,
    requisicoesApagadas,
  };
}

/**
 * As guias que a substituição alcança, com o que a tela precisa citar.
 *
 * Uma consulta só para a prévia e para a transação — é o que faz a prévia
 * dizer exatamente o que a transação apagaria naquele instante. O critério:
 *
 *   - guia do **mesmo paciente** (`r.paciente_id`): nunca a de outra pessoa;
 *   - de uma das terapias do envio;
 *   - em requisição de **outro número**: a de mesmo número é a pasta que
 *     recebe o envio, e a guia dela é atualizada (regra 5), não apagada.
 *
 * `ids` restringe às guias já travadas, dentro da transação; a prévia passa
 * `null`.
 */
async function guiasDaSubstituicao(
  cliente: Prisma.TransactionClient,
  pacienteId: number,
  numeroRequisicao: string,
  terapiaIds: number[],
  ids: number[] | null,
): Promise<GuiaSubstituida[]> {
  return cliente.$queryRaw<GuiaSubstituida[]>`
    SELECT
      rt."id"                AS "guiaId",
      t."id"                 AS "terapiaId",
      t."nome"               AS "terapiaNome",
      r."id"                 AS "requisicaoId",
      r."numero_requisicao"  AS "numeroRequisicao",
      (SELECT count(*)::int FROM "atendimento" a
        WHERE a."requisicao_terapia_id" = rt."id") AS "atendimentos"
    FROM "requisicao_terapia" rt
    JOIN "requisicao" r ON r."id" = rt."requisicao_id"
    JOIN "terapia"    t ON t."id" = rt."terapia_id"
    WHERE r."paciente_id" = ${pacienteId}
      AND r."numero_requisicao" <> ${numeroRequisicao}
      AND rt."terapia_id" = ANY(${terapiaIds}::int[])
      AND (${ids}::int[] IS NULL OR rt."id" = ANY(${ids}::int[]))
    ORDER BY rt."id"
  `;
}

/**
 * Apaga as guias substituídas e as requisições antigas que ficam vazias.
 *
 * Roda dentro da transação de {@link criarNaTransacao}, depois do
 * `FOR KEY SHARE` do paciente e antes de qualquer INSERT. Ordem de lock, a
 * mesma direção guia -> requisição de todo o resto (ver o topo de
 * `atendimentos.ts`):
 *
 *   1. `FOR UPDATE OF rt` nas guias alcançadas, **por id**. É o mesmo lock que
 *      o lançamento de atendimento pede: um lançamento em curso numa dessas
 *      guias faz esta transação esperar o commit dele (e o atendimento que ele
 *      gravou é apagado junto, pelo cascade); um lançamento que chegar depois
 *      espera esta, e ao destravar não acha mais a guia — recusa com "guia não
 *      encontrada", sem atendimento órfão nem erro de FK.
 *   2. A contagem de atendimentos, num comando novo (snapshot novo, já com o
 *      que o lançamento concorrente commitou).
 *   3. `excluirGuiaNaTransacao` em cada guia — a mesma exclusão do painel; o
 *      `FOR UPDATE` dela é sobre linha já travada, e o DELETE leva os
 *      atendimentos pelo `ON DELETE CASCADE`.
 *   4. `FOR UPDATE` nas requisições antigas, por id, e só **depois** o DELETE
 *      das que não têm mais guia, num comando novo: um cadastro concorrente
 *      que tenha acabado de pendurar guia numa delas é visto e a requisição
 *      fica.
 */
async function substituirGuiasNaTransacao(
  tx: Prisma.TransactionClient,
  pacienteId: number,
  numeroRequisicao: string,
  terapiaIds: number[],
): Promise<{ substituidas: GuiaSubstituida[]; requisicoesApagadas: string[] }> {
  const travadas = await tx.$queryRaw<{ id: number }[]>`
    SELECT rt."id"
    FROM "requisicao_terapia" rt
    JOIN "requisicao" r ON r."id" = rt."requisicao_id"
    WHERE r."paciente_id" = ${pacienteId}
      AND r."numero_requisicao" <> ${numeroRequisicao}
      AND rt."terapia_id" = ANY(${terapiaIds}::int[])
    ORDER BY rt."id"
    FOR UPDATE OF rt
  `;

  if (travadas.length === 0) {
    return { substituidas: [], requisicoesApagadas: [] };
  }

  const substituidas = await guiasDaSubstituicao(
    tx,
    pacienteId,
    numeroRequisicao,
    terapiaIds,
    travadas.map((guia) => guia.id),
  );

  for (const guia of substituidas) {
    const exclusao = await excluirGuiaNaTransacao(tx, guia.guiaId);

    // Inalcançável: a guia está travada por esta transação desde o passo 1.
    // Se acontecer, lançar desfaz tudo — melhor que seguir pela metade.
    if (!exclusao.ok) {
      throw new Error(`substituição: a guia ${guia.guiaId} sumiu sob lock`);
    }
  }

  const requisicaoIds = [
    ...new Set(substituidas.map((guia) => guia.requisicaoId)),
  ].sort((a, b) => a - b);

  await tx.$queryRaw`
    SELECT "id" FROM "requisicao"
    WHERE "id" = ANY(${requisicaoIds}::int[])
    ORDER BY "id"
    FOR UPDATE
  `;

  const apagadas = await tx.$queryRaw<{ numeroRequisicao: string }[]>`
    DELETE FROM "requisicao" r
    WHERE r."id" = ANY(${requisicaoIds}::int[])
      AND NOT EXISTS (
        SELECT 1 FROM "requisicao_terapia" rt WHERE rt."requisicao_id" = r."id"
      )
    RETURNING r."numero_requisicao" AS "numeroRequisicao"
  `;

  return {
    substituidas,
    requisicoesApagadas: apagadas.map((linha) => linha.numeroRequisicao).sort(),
  };
}

/**
 * O que a caixinha "Substituir" apagaria se o envio fosse gravado agora.
 *
 * **Só leitura**: nenhum lock, nenhuma escrita. Alimenta o diálogo de
 * confirmação do formulário; quem decide de verdade é a transação de
 * {@link criarRequisicao}, que refaz a mesma consulta sob `FOR UPDATE` e apaga
 * o que casar *naquele* momento.
 *
 * Nome que não é de paciente nenhum, ou entrada que não dá para consultar,
 * devolve lista vazia: o formulário então envia direto, e a recusa certa vem
 * da criação.
 */
export async function previsaoDeSubstituicao(
  pacienteNome: string,
  terapiaIds: number[],
  numeroRequisicao: string,
): Promise<GuiaSubstituida[]> {
  return previsaoDeSubstituicaoComCliente(
    getPrismaClient(),
    pacienteNome,
    terapiaIds,
    numeroRequisicao,
  );
}

/** {@link previsaoDeSubstituicao} num cliente dado — o teste passa a transação. */
export async function previsaoDeSubstituicaoComCliente(
  cliente: Prisma.TransactionClient,
  pacienteNome: string,
  terapiaIds: number[],
  numeroRequisicao: string,
): Promise<GuiaSubstituida[]> {
  const nome = pacienteNome.trim();
  const numero = numeroRequisicao.trim();
  const ids = [
    ...new Set(terapiaIds.filter((id) => Number.isInteger(id) && id > 0)),
  ];

  if (!nome || !numero || ids.length === 0) {
    return [];
  }

  // Mesma comparação de `buscarPacientePorNome`, sem o lock: aqui é leitura.
  const [paciente] = await cliente.$queryRaw<{ id: number }[]>`
    SELECT "id" FROM "paciente" WHERE lower("nome") = lower(${nome})
  `;

  if (!paciente) {
    return [];
  }

  return guiasDaSubstituicao(cliente, paciente.id, numero, ids, null);
}

/** Código do Prisma para violação de unique. */
const VIOLACAO_DE_UNIQUE = "P2002";

/** Nome da unique `(paciente_id, numero_requisicao)` no banco. */
const UNIQUE_NUMERO_POR_PACIENTE =
  "requisicao_paciente_id_numero_requisicao_key";

/** Nome da unique `(requisicao_id, terapia_id)` no banco. */
const UNIQUE_TERAPIA_POR_REQUISICAO =
  "requisicao_terapia_requisicao_id_terapia_id_key";

/** `true` se `erro` é o choque com a unique chamada `nome`. */
function violouUnique(erro: unknown, nome: string): boolean {
  if (typeof erro !== "object" || erro === null) {
    return false;
  }

  const candidato = erro as { code?: unknown; meta?: unknown };

  if (candidato.code !== VIOLACAO_DE_UNIQUE) {
    return false;
  }

  // O nome da constraint não chega sempre no mesmo lugar: sem driver adapter
  // ele vem em `meta.target`; com o `@prisma/adapter-pg` que o projeto usa,
  // vem em `meta.driverAdapterError.cause.constraint.index` e `target` nem
  // existe. Serializar o `meta` inteiro cobre as duas formas.
  return JSON.stringify(candidato.meta ?? "").includes(nome);
}

/**
 * Cria a requisição inteira, abrindo a própria transação.
 *
 * Validação sem banco primeiro; depois a transação. Erro de negócio lançado lá
 * dentro chega aqui já com a transação desfeita, e vira `{ ok: false }`.
 */
export async function criarRequisicao(
  entrada: EntradaNovaRequisicao,
): Promise<ResultadoCriacao> {
  const validacao = validarEntrada(entrada);

  if (!validacao.ok) {
    return { ok: false, erro: validacao.erro, linha: validacao.linha };
  }

  try {
    return await getPrismaClient().$transaction(
      (tx) => criarNaTransacao(tx, entrada),
      OPCOES_DE_TRANSACAO,
    );
  } catch (erro) {
    if (erro instanceof ErroDeNegocio) {
      return { ok: false, erro: erro.erro, linha: erro.linha };
    }

    // Corrida perdida na pré-checagem do número: dois envios do *primeiro*
    // cadastro daquele número chegaram juntos, os dois viram o SELECT vazio e
    // os dois tentaram inserir. A unique do banco pegou o segundo. A transação
    // já foi desfeita, então nada ficou pela metade — e reenviar resolve, que
    // é o que a mensagem pede: a requisição existe agora, e o envio seguinte
    // cai no ramo que acrescenta as terapias a ela.
    if (violouUnique(erro, UNIQUE_NUMERO_POR_PACIENTE)) {
      return {
        ok: false,
        erro: erroCorridaNaRequisicao(
          entrada.numeroRequisicao.trim(),
          entrada.pacienteNome.trim(),
        ),
      };
    }

    // A mesma corrida, um nível abaixo: dois envios simultâneos trazendo a
    // mesma terapia *nova* para a mesma requisição, os dois sem ver a guia no
    // `findMany`, os dois tentando inseri-la. Reenviar cai no ramo que
    // atualiza a guia que o outro acabou de criar.
    if (violouUnique(erro, UNIQUE_TERAPIA_POR_REQUISICAO)) {
      return {
        ok: false,
        erro: erroCorridaNaGuia(
          entrada.numeroRequisicao.trim(),
          entrada.pacienteNome.trim(),
        ),
      };
    }

    throw erro;
  }
}

/**
 * Versão de {@link criarRequisicao} que roda numa transação já aberta.
 *
 * Existe para o teste de integração: ele precisa criar de verdade e desfazer
 * tudo no fim. Aqui o erro de negócio vira `{ ok: false }` sem desfazer nada —
 * quem controla o rollback é o chamador.
 *
 * Em produção use {@link criarRequisicao}: é ela que garante a atomicidade.
 */
export async function criarRequisicaoNaTransacao(
  tx: Prisma.TransactionClient,
  entrada: EntradaNovaRequisicao,
): Promise<ResultadoCriacao> {
  const validacao = validarEntrada(entrada);

  if (!validacao.ok) {
    return { ok: false, erro: validacao.erro, linha: validacao.linha };
  }

  try {
    return await criarNaTransacao(tx, entrada);
  } catch (erro) {
    if (erro instanceof ErroDeNegocio) {
      return { ok: false, erro: erro.erro, linha: erro.linha };
    }

    throw erro;
  }
}

/** Terapias disponíveis, em ordem alfabética. */
export async function listarTerapias(): Promise<TerapiaParaEscolha[]> {
  return getPrismaClient().$queryRaw<TerapiaParaEscolha[]>`
    SELECT "id", "nome", "codigo_tiss" AS "codigoTiss"
    FROM "terapia"
    ORDER BY lower("nome"), "id"
  `;
}

/**
 * A validade que uma linha de terapia já nasce preenchida no formulário: **um
 * mês de calendário** depois de hoje, como "AAAA-MM-DD".
 *
 * Só um valor inicial, como o `4` de "Qtd. autorizada" — o campo continua
 * editável e continua opcional. Quem grava é `criarRequisicao`, com o que veio
 * do formulário; nada aqui é recalculado no servidor depois que o usuário
 * mexeu no campo.
 *
 * O motivo de negócio é que uma autorização parada perde validade real por
 * volta de um mês: com este padrão, a guia que ninguém usou entra sozinha em
 * "Renovar" na janela certa, em vez de ficar "Regular" para sempre por ter
 * nascido sem validade. A regra de `status_alerta` (validade a <= 7 dias) não
 * muda por causa disto — ela continua sendo da view.
 *
 * **Um mês, não 30 dias.** `INTERVAL '1 month'` é aritmética de calendário: o
 * Postgres grampeia o dia no último do mês de destino quando ele não existe,
 * então 31/01 dá 28/02 (29/02 em ano bissexto), não 03/03. É o mesmo desenho
 * do `+ INTERVAL '180 days'` de `encaminhamento.data_vencimento` — a diferença
 * é a unidade, e é ela que faz a fronteira de mês cair no lugar certo.
 *
 * Vem do `CURRENT_DATE` do **banco**, não do relógio do Node nem do navegador,
 * pelo mesmo motivo da data padrão de "Lançar atendimento": é o mesmo "hoje"
 * que a view usa para decidir "Renovar" por validade, e um servidor em UTC
 * discordaria dele à noite no horário de Brasília.
 *
 * @param referencia "AAAA-MM-DD" no lugar de hoje. Existe para o teste poder
 *   mirar fronteiras de mês que o `CURRENT_DATE` só ofereceria em janeiro; em
 *   produção nunca é passado.
 */
export async function validadePadraoDeGuia(
  referencia?: string,
): Promise<string> {
  const [linha] = await getPrismaClient().$queryRaw<{ validade: string }[]>`
    SELECT (
      COALESCE(${referencia ?? null}::text::date, CURRENT_DATE) + INTERVAL '1 month'
    )::date::text AS "validade"
  `;

  return linha.validade;
}

export type ResultadoAlteracaoDeSituacao =
  | {
      ok: true;
      requisicaoId: number;
      numeroRequisicao: string;
      situacao: SituacaoDeRequisicao;
    }
  | { ok: false; erro: string };

/**
 * Grava a situação de uma requisição ("solicitada" ou "aprovada").
 *
 * Vale nos dois sentidos — voltar uma aprovada para solicitada corrige um
 * clique errado — e é idempotente: gravar a situação que já está lá não é
 * erro. Quem pode chamar isto é decidido na Server Action
 * (`alterarSituacaoDaRequisicaoAction`), com o papel lido do banco.
 *
 * Um único UPDATE, sem transação aberta à mão e sem travar nenhuma outra
 * tabela: ele pede `FOR NO KEY UPDATE` só nesta linha de `requisicao`, que
 * conflita com o `FOR SHARE` de um lançamento de atendimento em curso. Um
 * lançamento que já travou a requisição faz este UPDATE esperar o commit
 * dele; o contrário faz o lançamento esperar e enxergar a situação nova. Como
 * segura um lock só e não espera nenhum outro segurando-o, não entra em ciclo
 * de deadlock — ver a ordem de lock em `lib/domain/atendimentos.ts`.
 *
 * A situação é dado gravado, não calculado: a view `requisicao_terapia_saldo`
 * e o `status_alerta` não mudam com ela.
 */
export async function alterarSituacaoDaRequisicao(
  requisicaoId: number,
  situacao: string,
): Promise<ResultadoAlteracaoDeSituacao> {
  if (!Number.isInteger(requisicaoId) || requisicaoId <= 0) {
    return { ok: false, erro: ERRO_REQUISICAO_ID_INVALIDO };
  }

  // Validada aqui contra a lista, e o CHECK do banco é o backstop: uma
  // situação inventada vira mensagem, não exceção de driver.
  if (!ehSituacaoValida(situacao)) {
    return { ok: false, erro: ERRO_SITUACAO_INVALIDA };
  }

  const [linha] = await getPrismaClient().$queryRaw<
    { id: number; numeroRequisicao: string; situacao: string }[]
  >`
    UPDATE "requisicao"
    SET "situacao" = ${situacao}
    WHERE "id" = ${requisicaoId}
    RETURNING
      "id"                AS "id",
      "numero_requisicao" AS "numeroRequisicao",
      "situacao"          AS "situacao"
  `;

  if (!linha) {
    return { ok: false, erro: ERRO_REQUISICAO_INEXISTENTE };
  }

  return {
    ok: true,
    requisicaoId: linha.id,
    numeroRequisicao: linha.numeroRequisicao,
    situacao: comoSituacao(linha.situacao),
  };
}

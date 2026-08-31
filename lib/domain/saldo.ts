/**
 * Espelho em TypeScript das formulas de saldo da view SQL
 * `requisicao_terapia_saldo`.
 *
 * ATENCAO: este modulo NAO e fonte de verdade. Em producao, saldo e status
 * sempre saem da view (CONTEXT.md, secao "Campos calculados"). Estas funcoes
 * existem para:
 *
 *   1. servir de especificacao executavel das regras, com testes de borda;
 *   2. validar em teste de integracao que a view continua calculando a mesma
 *      coisa (ver `saldo.integration.test.ts`).
 *
 * Nenhum codigo de aplicacao (Server Action, page, route handler) deve
 * importar daqui para exibir ou decidir saldo.
 *
 * Precisao: a view calcula `qtd_autorizada / 4` como `numeric`. Aqui usamos
 * divisao de ponto flutuante, mas 4 e potencia de 2 — logo `n / 4` e exato em
 * double para qualquer inteiro na faixa que o Postgres guarda num `int`. Nao
 * ha divergencia de arredondamento entre os dois lados.
 */

/** Os tres valores possiveis de `status_alerta`, em ordem de precedencia. */
export type StatusAlerta = "Esgotada" | "Renovar" | "Regular";

/** Divisor de `creditos_por_sessao`: a autorizacao cobre 4 sessoes/mes. */
export const SESSOES_POR_CICLO = 4;

/** Janela, em dias, em que a validade proxima ja dispara "Renovar". */
export const DIAS_PARA_RENOVAR = 7;

/** Uma guia (`requisicao_terapia`) reduzida ao que afeta o calculo. */
export type GuiaParaCalculo = {
  /** `qtd_autorizada`. Nulo/indefinido e tratado como 0, igual ao COALESCE da view. */
  qtdAutorizada: number | null | undefined;
  /** Soma dos creditos ja consumidos. Ver {@link qtdUtilizada}. */
  qtdUtilizada: number | null | undefined;
  /** `validade` da guia; nula quando a guia nao expira. */
  validade: Date | null | undefined;
};

/** Resultado completo, com os mesmos nomes das colunas da view. */
export type SaldoCalculado = {
  qtdUtilizada: number;
  saldoRestante: number;
  creditosPorSessao: number;
  statusAlerta: StatusAlerta;
};

/** `COALESCE(valor, 0)` — a view nunca deixa nulo chegar na aritmetica. */
function ouZero(valor: number | null | undefined): number {
  return valor ?? 0;
}

/**
 * `qtd_utilizada` = soma de `creditos_consumidos` dos atendimentos da guia.
 *
 * Guia sem atendimento nenhum da 0 (na view isso vem do LEFT JOIN + COALESCE).
 */
export function qtdUtilizada(
  creditosConsumidos: readonly (number | null | undefined)[],
): number {
  return creditosConsumidos.reduce<number>(
    (soma, creditos) => soma + ouZero(creditos),
    0,
  );
}

/**
 * `saldo_restante` = `qtd_autorizada - qtd_utilizada`.
 *
 * Pode ser negativo: a view nao faz clamp em 0, e o status "Esgotada" ja cobre
 * esse caso.
 */
export function saldoRestante(
  qtdAutorizadaValor: number | null | undefined,
  qtdUtilizadaValor: number | null | undefined,
): number {
  return ouZero(qtdAutorizadaValor) - ouZero(qtdUtilizadaValor);
}

/**
 * `creditos_por_sessao` = `qtd_autorizada / 4`, com casas decimais (10 => 2.5).
 *
 * 0 quando `qtd_autorizada` e vazio/0 — sem isso a guia sem autorizacao teria
 * um limiar de "Renovar" igual a 0 e nunca cairia nele.
 */
export function creditosPorSessao(
  qtdAutorizadaValor: number | null | undefined,
): number {
  const autorizada = ouZero(qtdAutorizadaValor);

  if (autorizada === 0) {
    return 0;
  }

  return autorizada / SESSOES_POR_CICLO;
}

/**
 * Trunca uma data no dia (UTC) e devolve o numero de dias desde a epoca.
 *
 * Colunas `DATE` do Postgres chegam pelo Prisma como meia-noite UTC, entao a
 * leitura em UTC e a que preserva o dia gravado. A data de referencia (`hoje`)
 * tambem e lida em UTC — quem chama e responsavel por passar uma referencia no
 * mesmo fuso que o `CURRENT_DATE` do banco quando quiser comparar os dois.
 */
function diaUtc(data: Date): number {
  return Date.UTC(
    data.getUTCFullYear(),
    data.getUTCMonth(),
    data.getUTCDate(),
  ) / 86_400_000;
}

/** Dias inteiros de `hoje` ate `validade` (negativo se ja venceu). */
export function diasAteValidade(validade: Date, hoje: Date): number {
  return diaUtc(validade) - diaUtc(hoje);
}

/**
 * `status_alerta`, com a mesma ordem de precedencia da view:
 * **Esgotada > Renovar > Regular**.
 *
 * - "Esgotada": `qtd_autorizada` vazio/0 OU `saldo_restante <= 0`;
 * - "Renovar": `saldo_restante <= qtd_autorizada / 4` OU validade a <= 7 dias
 *   (inclusive — exatamente 7 dias ja e "Renovar", e validade vencida tambem);
 * - "Regular": o resto. Validade nula nunca dispara "Renovar" por prazo.
 *
 * @param hoje Data de referencia, para o teste nao depender do relogio. Na
 *   comparacao com a view, passe o `CURRENT_DATE` do proprio banco.
 */
export function statusAlerta(
  guia: GuiaParaCalculo,
  hoje: Date = new Date(),
): StatusAlerta {
  const autorizada = ouZero(guia.qtdAutorizada);
  const saldo = saldoRestante(autorizada, guia.qtdUtilizada);

  if (autorizada === 0 || saldo <= 0) {
    return "Esgotada";
  }

  if (saldo <= autorizada / SESSOES_POR_CICLO) {
    return "Renovar";
  }

  if (
    guia.validade != null &&
    diasAteValidade(guia.validade, hoje) <= DIAS_PARA_RENOVAR
  ) {
    return "Renovar";
  }

  return "Regular";
}

/** Os quatro campos calculados de uma guia, como a view devolveria. */
export function calcularSaldo(
  guia: GuiaParaCalculo,
  hoje: Date = new Date(),
): SaldoCalculado {
  return {
    qtdUtilizada: ouZero(guia.qtdUtilizada),
    saldoRestante: saldoRestante(guia.qtdAutorizada, guia.qtdUtilizada),
    creditosPorSessao: creditosPorSessao(guia.qtdAutorizada),
    statusAlerta: statusAlerta(guia, hoje),
  };
}

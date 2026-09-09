-- Encaminhamento medico de um paciente.
--
-- `data_vencimento` e uma COLUNA GERADA pelo proprio Postgres. A regra de
-- negocio e "180 dias corridos depois do encaminhamento" — nao seis meses de
-- calendario — e ela mora aqui, numa unica fonte de verdade, pela mesma razao
-- que o saldo/status de guia mora na view `requisicao_terapia_saldo`: formula
-- derivada replicada em codigo de aplicacao acaba divergindo do banco.
-- Nenhum codigo TypeScript calcula este vencimento.
--
-- Detalhes da expressao:
--   * `date + interval` devolve `timestamp`, nao `date`. O `::date` explicito
--     e o que faz a expressao caber na coluna DATE sem depender de cast de
--     atribuicao implicito.
--   * a coluna e deixada NULLABLE de proposito. Ela nunca e nula na pratica
--     (`data_encaminhamento` e NOT NULL, e a soma de um NOT NULL com um
--     intervalo constante tambem nao e nula), mas o Prisma nao sabe expressar
--     coluna gerada no `schema.prisma`: declara-la opcional dos dois lados e o
--     que mantem o modelo e o banco em acordo, sem `migrate dev` propondo um
--     `SET NOT NULL` a cada rodada. Quem protege contra escrita e o proprio
--     GENERATED ALWAYS: o Postgres recusa qualquer INSERT/UPDATE que tente
--     gravar um valor aqui.
--   * `STORED` e obrigatorio: o Postgres 16 nao implementa coluna gerada
--     virtual.
CREATE TABLE "encaminhamento" (
    "id" SERIAL NOT NULL,
    "paciente_id" INTEGER NOT NULL,
    "data_encaminhamento" DATE NOT NULL,
    "data_vencimento" DATE GENERATED ALWAYS AS (("data_encaminhamento" + INTERVAL '180 days')::date) STORED,

    CONSTRAINT "encaminhamento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "encaminhamento_paciente_id_idx" ON "encaminhamento"("paciente_id");

-- AddForeignKey
-- Mesmo padrao das demais FKs para `paciente` (regra do CONTEXT.md: so o
-- caminho atendimento -> requisicao_terapia usa CASCADE).
ALTER TABLE "encaminhamento" ADD CONSTRAINT "encaminhamento_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "paciente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

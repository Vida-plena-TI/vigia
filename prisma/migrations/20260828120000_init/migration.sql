-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "paciente" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,

    CONSTRAINT "paciente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuario" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terapia" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "codigo_tiss" TEXT NOT NULL,

    CONSTRAINT "terapia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requisicao" (
    "id" SERIAL NOT NULL,
    "numero_requisicao" TEXT NOT NULL,
    "paciente_id" INTEGER NOT NULL,

    CONSTRAINT "requisicao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requisicao_terapia" (
    "id" SERIAL NOT NULL,
    "qtd_autorizada" INTEGER NOT NULL,
    "validade" DATE,
    "requisicao_id" INTEGER NOT NULL,
    "terapia_id" INTEGER NOT NULL,

    CONSTRAINT "requisicao_terapia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "atendimento" (
    "id" SERIAL NOT NULL,
    "data_atendimento" DATE NOT NULL,
    "creditos_consumidos" INTEGER NOT NULL DEFAULT 1,
    "observacao" TEXT,
    "requisicao_terapia_id" INTEGER NOT NULL,

    CONSTRAINT "atendimento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "paciente_nome_idx" ON "paciente"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_username_key" ON "usuario"("username");

-- CreateIndex
CREATE UNIQUE INDEX "terapia_nome_key" ON "terapia"("nome");

-- CreateIndex
CREATE INDEX "requisicao_numero_requisicao_idx" ON "requisicao"("numero_requisicao");

-- CreateIndex
CREATE INDEX "requisicao_paciente_id_idx" ON "requisicao"("paciente_id");

-- CreateIndex
CREATE UNIQUE INDEX "requisicao_paciente_id_numero_requisicao_key" ON "requisicao"("paciente_id", "numero_requisicao");

-- CreateIndex
CREATE INDEX "requisicao_terapia_requisicao_id_idx" ON "requisicao_terapia"("requisicao_id");

-- CreateIndex
CREATE INDEX "requisicao_terapia_terapia_id_idx" ON "requisicao_terapia"("terapia_id");

-- CreateIndex
CREATE INDEX "atendimento_requisicao_terapia_id_idx" ON "atendimento"("requisicao_terapia_id");

-- AddForeignKey
ALTER TABLE "requisicao" ADD CONSTRAINT "requisicao_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "paciente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisicao_terapia" ADD CONSTRAINT "requisicao_terapia_requisicao_id_fkey" FOREIGN KEY ("requisicao_id") REFERENCES "requisicao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisicao_terapia" ADD CONSTRAINT "requisicao_terapia_terapia_id_fkey" FOREIGN KEY ("terapia_id") REFERENCES "terapia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atendimento" ADD CONSTRAINT "atendimento_requisicao_terapia_id_fkey" FOREIGN KEY ("requisicao_terapia_id") REFERENCES "requisicao_terapia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

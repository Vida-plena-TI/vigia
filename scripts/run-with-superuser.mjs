#!/usr/bin/env node
/**
 * Roda um comando (tipicamente da CLI do Prisma) com a conexao privilegiada do
 * banco, sem tocar no `.env` em disco e sem alterar a variavel no processo pai.
 *
 *   node scripts/run-with-superuser.mjs prisma migrate dev
 *   node scripts/run-with-superuser.mjs prisma migrate deploy
 *
 * Por que isso existe
 * -------------------
 * `DATABASE_URL` aponta para um role restrito, so com DML (SELECT/INSERT/
 * UPDATE/DELETE) — e ele que o Prisma Client usa em runtime na aplicacao.
 * Mas a CLI do Prisma resolve *a mesma* variavel para saber onde aplicar
 * migrations, e migrations sao DDL (CREATE/ALTER/DROP), que o role restrito
 * nao pode executar.
 *
 * Este script resolve isso sobrescrevendo `DATABASE_URL` com o valor de
 * `DATABASE_SUPERUSER_URL` **apenas no ambiente do processo filho**. O `.env`
 * nao e modificado, e a credencial privilegiada nao vaza para mais nada.
 *
 * E Node puro de proposito: `VAR=x comando` (bash) e `$env:VAR='x'; comando`
 * (PowerShell) tem sintaxes incompativeis, entao um npm script que usasse
 * qualquer uma das duas quebraria na outra plataforma.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

const PREFIX = "[run-with-superuser]";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** Erro fatal com mensagem legivel, sem stack trace de Node. */
function fail(message) {
  console.error(`\n${PREFIX} ${message}\n`);
  process.exit(1);
}

/** Esconde a senha antes de logar uma connection string. */
function mascarar(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "<url invalida>";
  }
}

/** Identidade do banco alvo, para comparar duas connection strings. */
function alvo(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port}${u.pathname}`;
  } catch {
    return null;
  }
}

/**
 * Resolve o entrypoint JS de uma CLI instalada em node_modules e o executa com
 * o proprio Node, em vez de invocar o shim de shell.
 *
 * Isso evita `shell: true`: no Windows os shims sao `.cmd`, que o Node se
 * recusa a executar sem shell desde a correcao da CVE-2024-27980, e passar
 * pelo shell reintroduz problemas de quoting em caminhos com espaco — como
 * "C:\projeto vida plena\VIGIA".
 */
function resolverCliDoNodeModules(comando) {
  const pkgJsonPath = path.join(
    projectRoot,
    "node_modules",
    comando,
    "package.json",
  );

  if (!existsSync(pkgJsonPath)) return null;

  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  } catch {
    return null;
  }

  const entry = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.[comando];
  if (!entry) return null;

  const resolvido = path.join(path.dirname(pkgJsonPath), entry);
  return existsSync(resolvido) ? resolvido : null;
}

// --- carga do ambiente -------------------------------------------------------
// Le o .env do projeto independente do cwd. O `override` padrao do dotenv e
// `false`, entao variaveis ja presentes no ambiente vencem o arquivo — que e o
// comportamento desejado em CI e no deploy, onde nao existe .env.
dotenv.config({ path: path.join(projectRoot, ".env"), quiet: true });

const args = process.argv.slice(2);

if (args.length === 0) {
  fail(
    [
      "Nenhum comando informado.",
      "",
      "Uso: node scripts/run-with-superuser.mjs <comando> [args...]",
      "Ex.: node scripts/run-with-superuser.mjs prisma migrate dev",
    ].join("\n"),
  );
}

const superuserUrl = process.env.DATABASE_SUPERUSER_URL?.trim();

if (!superuserUrl) {
  fail(
    [
      "DATABASE_SUPERUSER_URL nao esta definida.",
      "",
      "Migrations executam DDL (CREATE/ALTER/DROP), e o DATABASE_URL da",
      "aplicacao aponta para um role restrito que so tem DML. Por isso os",
      "comandos de migration precisam de uma conexao privilegiada separada.",
      "",
      "Defina no .env (dev) ou nas variaveis de ambiente do deploy:",
      "  DATABASE_SUPERUSER_URL=postgresql://USUARIO:SENHA@HOST:PORTA/BANCO?schema=public",
      "",
      "Ela precisa apontar para o MESMO banco do DATABASE_URL, mudando apenas",
      "o usuario — senao as migrations sao aplicadas no banco errado.",
    ].join("\n"),
  );
}

// Aviso (nao bloqueia) quando as duas URLs apontam para bancos diferentes: e o
// erro mais caro possivel aqui, porque falha em silencio, migrando um banco que
// nao e o da aplicacao.
const alvoApp = process.env.DATABASE_URL ? alvo(process.env.DATABASE_URL) : null;
const alvoSuper = alvo(superuserUrl);

if (alvoApp && alvoSuper && alvoApp !== alvoSuper) {
  console.error(
    `${PREFIX} AVISO: DATABASE_SUPERUSER_URL aponta para ${alvoSuper}, mas ` +
      `DATABASE_URL aponta para ${alvoApp}. As migrations serao aplicadas em ` +
      `${alvoSuper}.`,
  );
}

// --- execucao ----------------------------------------------------------------
const [comando, ...resto] = args;

// A sobrescrita vive so neste objeto, que e entregue ao filho. `process.env` do
// processo pai continua intacto.
const envDoFilho = { ...process.env, DATABASE_URL: superuserUrl };

console.error(
  `${PREFIX} ${args.join(" ")} -> ${mascarar(superuserUrl)}`,
);

const cli = resolverCliDoNodeModules(comando);

const filho = cli
  ? spawn(process.execPath, [cli, ...resto], {
      stdio: "inherit",
      env: envDoFilho,
      cwd: projectRoot,
    })
  : spawn(comando, resto, {
      stdio: "inherit",
      env: envDoFilho,
      cwd: projectRoot,
      shell: process.platform === "win32",
    });

filho.on("error", (erro) => {
  fail(`Nao foi possivel executar "${comando}": ${erro.message}`);
});

filho.on("exit", (code, signal) => {
  // `stdio: "inherit"` mantem o comando interativo — `migrate dev` ainda
  // consegue perguntar o nome da migration no terminal.
  if (signal) {
    console.error(`${PREFIX} "${comando}" terminou pelo sinal ${signal}.`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});

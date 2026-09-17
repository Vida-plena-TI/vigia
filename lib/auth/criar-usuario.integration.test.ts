/**
 * Papel de usuario contra o Postgres real (Fase A).
 *
 * O que este arquivo prova, e por que cada prova precisa do banco:
 *
 *   1. **`create-admin` grava `papel = 'admin'` e `create-recepcao` grava
 *      `papel = 'recepcao'`.** Os dois scripts sao casca em volta de
 *      `criarOuAtualizarUsuario`, que e o que esta exercitado aqui — a parte
 *      que os scripts nao compartilham (ler `ADMIN_*` / `RECEPCAO_*`) e
 *      afirmada por leitura do proprio fonte, no fim do arquivo.
 *   2. **Idempotencia**: rodar de novo redefine a senha, mantem uma unica
 *      linha e nao perde o papel.
 *   3. **O backfill da migration**, em duas metades que juntas fecham a prova:
 *      o SQL do arquivo em `prisma/migrations/` e reaplicado de verdade sobre
 *      linhas pre-existentes (numa copia temporaria — ver
 *      `comandosDaMigration`), e o estado final da tabela `usuario` de verdade
 *      e inspecionado no catalogo do Postgres. Nenhuma das duas reescreve a
 *      regra em TypeScript; isso provaria apenas que o teste concorda consigo
 *      mesmo.
 *   4. **O CHECK `usuario_papel_valido`** recusa papel fora da lista — a prova
 *      de que `PAPEIS` (`lib/auth/papel.ts`) espelha o banco, e nao o
 *      contrario.
 *
 * Como roda (mesmo contrato dos testes de `lib/domain/`):
 *   - precisa de DATABASE_URL com as migrations aplicadas; sem ela o bloco e
 *     pulado em vez de falhar;
 *   - tudo roda dentro de uma transacao que sempre sofre rollback, entao o banco
 *     nao fica com lixo.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { getPrismaClient } from "@/lib/db";

import { criarOuAtualizarUsuario } from "./criar-usuario";
import { verifyPassword } from "./password";

const temBanco = Boolean(process.env.DATABASE_URL);

/** Sufixo unico para nao colidir com usuario ja existente no banco de dev. */
const SUFIXO = Math.random().toString(36).slice(2, 10);

const CAMINHO_DA_MIGRATION = fileURLToPath(
  new URL(
    "../../prisma/migrations/20260917120000_papel_de_usuario/migration.sql",
    import.meta.url,
  ),
);

/** Erro sentinela: rola a transacao de volta depois de coletar o resultado. */
class Rollback<T> extends Error {
  constructor(readonly dados: T) {
    super("rollback proposital do teste de integracao");
  }
}

type ClienteDaTransacao = Parameters<
  Parameters<ReturnType<typeof getPrismaClient>["$transaction"]>[0]
>[0];

/** Roda `executar` numa transacao e desfaz tudo, devolvendo o que ela produziu. */
async function comRollback<T>(
  executar: (tx: ClienteDaTransacao) => Promise<T>,
): Promise<T> {
  try {
    await getPrismaClient().$transaction(
      async (tx) => {
        throw new Rollback(await executar(tx));
      },
      // bcrypt a 12 rounds dentro da transacao: o padrao de 5s nao cobre.
      { maxWait: 30_000, timeout: 30_000 },
    );
  } catch (erro) {
    if (erro instanceof Rollback) {
      return erro.dados as T;
    }
    throw erro;
  }

  throw new Error("a transacao deveria ter sofrido rollback");
}

/**
 * Quebra o arquivo de migration nos comandos que ele contem, apontados para
 * `alvo` em vez de `usuario`.
 *
 * Duas razoes para o arquivo nao ir inteiro num `$executeRawUnsafe`: o adapter
 * `pg` do Prisma manda uma instrucao por chamada, e as linhas de comentario
 * precisam sair antes do split para nenhum `;` dentro de comentario contar como
 * fim de comando.
 *
 * O redirecionamento de tabela existe porque o role de runtime (`DATABASE_URL`)
 * **nao e dono de `usuario`** e o Postgres recusa o `ALTER TABLE` dele — o que e
 * o comportamento certo, e a mesma separacao de privilegio que faz as migrations
 * rodarem pelo `DATABASE_SUPERUSER_URL`. Uma tabela temporaria pertence a sessao
 * que a criou, entao o teste roda o DDL sem privilegio nenhum a mais.
 *
 * O que se perde com isso e so o nome da tabela: as instrucoes, a ordem e os
 * valores sao os do arquivo, e um `DEFAULT` reintroduzido ou um CHECK afrouxado
 * la aparece aqui. Que a tabela de verdade tenha o estado final que a migration
 * promete e conferido a parte, pelo catalogo.
 */
function comandosDaMigration(sql: string, alvo: string): string[] {
  return sql
    .split("\n")
    .filter((linha) => !linha.trimStart().startsWith("--"))
    .join("\n")
    .replaceAll('"usuario"', `"${alvo}"`)
    .split(";")
    .map((comando) => comando.trim())
    .filter(Boolean);
}

describe.skipIf(!temBanco)("papel de usuario no banco", () => {
  afterAll(async () => {
    await getPrismaClient().$disconnect();
  });

  it("create-admin grava papel 'admin'", async () => {
    const username = `teste-admin-${SUFIXO}`;

    const { conta, gravado } = await comRollback(async (tx) => {
      const conta = await criarOuAtualizarUsuario(tx, {
        username,
        senha: "senha-de-teste-1",
        papel: "admin",
      });

      const gravado = await tx.usuario.findUniqueOrThrow({
        where: { username },
        select: { papel: true, ativo: true },
      });

      return { conta, gravado };
    });

    expect(conta.jaExistia).toBe(false);
    expect(conta.papel).toBe("admin");
    // O que importa e o que ficou na linha, nao o que a funcao devolveu.
    expect(gravado.papel).toBe("admin");
    expect(gravado.ativo).toBe(true);
  });

  it("create-recepcao grava papel 'recepcao'", async () => {
    const username = `teste-recepcao-${SUFIXO}`;

    const { conta, gravado } = await comRollback(async (tx) => {
      const conta = await criarOuAtualizarUsuario(tx, {
        username,
        senha: "senha-de-teste-1",
        papel: "recepcao",
      });

      const gravado = await tx.usuario.findUniqueOrThrow({
        where: { username },
        select: { papel: true, ativo: true },
      });

      return { conta, gravado };
    });

    expect(conta.jaExistia).toBe(false);
    expect(conta.papel).toBe("recepcao");
    expect(gravado.papel).toBe("recepcao");
    expect(gravado.ativo).toBe(true);
  });

  it("rodar de novo redefine a senha sem duplicar a linha nem perder o papel", async () => {
    const username = `teste-idem-${SUFIXO}`;
    const senhaVelha = "senha-velha-000";
    const senhaNova = "senha-nova-111";

    const resultado = await comRollback(async (tx) => {
      const primeira = await criarOuAtualizarUsuario(tx, {
        username,
        senha: senhaVelha,
        papel: "recepcao",
      });

      const segunda = await criarOuAtualizarUsuario(tx, {
        username,
        senha: senhaNova,
        papel: "recepcao",
      });

      const linha = await tx.usuario.findUniqueOrThrow({
        where: { username },
        select: { id: true, papel: true, ativo: true, passwordHash: true },
      });

      return {
        primeira,
        segunda,
        linha,
        linhas: await tx.usuario.count({ where: { username } }),
      };
    });

    // Uma linha so, e a mesma linha: o upsert atualizou, nao inseriu outra.
    expect(resultado.linhas).toBe(1);
    expect(resultado.segunda.id).toBe(resultado.primeira.id);
    expect(resultado.linha.id).toBe(resultado.primeira.id);

    // A segunda passada se reconhece como atualizacao — e o que o script
    // imprime para o operador.
    expect(resultado.primeira.jaExistia).toBe(false);
    expect(resultado.segunda.jaExistia).toBe(true);

    // O papel sobrevive a redefinicao de senha.
    expect(resultado.linha.papel).toBe("recepcao");

    // A senha realmente trocou: a nova vale, a velha nao.
    await expect(
      verifyPassword(senhaNova, resultado.linha.passwordHash),
    ).resolves.toBe(true);
    await expect(
      verifyPassword(senhaVelha, resultado.linha.passwordHash),
    ).resolves.toBe(false);
  });

  it("reativa a conta desativada em vez de falhar por duplicata", async () => {
    const username = `teste-reativa-${SUFIXO}`;

    const gravado = await comRollback(async (tx) => {
      await criarOuAtualizarUsuario(tx, {
        username,
        senha: "senha-de-teste-1",
        papel: "admin",
      });

      await tx.usuario.update({ where: { username }, data: { ativo: false } });

      await criarOuAtualizarUsuario(tx, {
        username,
        senha: "senha-de-teste-2",
        papel: "admin",
      });

      return tx.usuario.findUniqueOrThrow({
        where: { username },
        select: { ativo: true, papel: true },
      });
    });

    expect(gravado.ativo).toBe(true);
    expect(gravado.papel).toBe("admin");
  });

  it("o banco recusa papel fora da lista de PAPEIS", async () => {
    const username = `teste-papel-invalido-${SUFIXO}`;

    await expect(
      comRollback(async (tx) =>
        // `papel` e `String` no Prisma, entao so o CHECK do Postgres barra
        // isto — nenhuma validacao de aplicacao esta no caminho.
        tx.usuario.create({
          data: {
            username,
            passwordHash: "nao-importa",
            ativo: true,
            papel: "medico",
          },
          select: { id: true },
        }),
      ),
    ).rejects.toThrow(/usuario_papel_valido|check constraint/i);
  });

  it("a migration backfilla com 'admin' as linhas que ja existiam", async () => {
    // Nome unico por rodada: duas execucoes simultaneas nao se atropelam.
    const alvo = `usuario_pre_papel_${SUFIXO}`;
    const comandos = comandosDaMigration(
      readFileSync(CAMINHO_DA_MIGRATION, "utf8"),
      alvo,
    );

    // A migration tem de ser exatamente os tres comandos que este teste espera
    // exercitar. Se alguem acrescentar um quarto, e melhor o teste falhar aqui
    // do que passar calado sobre um comando que ele nunca viu.
    expect(comandos).toHaveLength(3);

    const resultado = await comRollback(async (tx) => {
      // 1. Reconstroi a tabela como ela era ANTES desta migration: sem `papel`,
      //    e ja povoada com as linhas reais do banco. A copia e temporaria
      //    porque o role de runtime nao pode dar `ALTER TABLE` em `usuario`
      //    (ver `comandosDaMigration`); os dados, porem, sao os de verdade.
      await tx.$executeRawUnsafe(
        `CREATE TEMP TABLE "${alvo}" ON COMMIT DROP AS
         SELECT "id", "username", "password_hash", "ativo" FROM "usuario"`,
      );

      // 2. Acrescenta duas linhas "antigas" as que vieram junto, para a prova
      //    valer tambem num banco que estivesse vazio. A inativa esta ali de
      //    proposito: o backfill nao pode pular linha desativada.
      await tx.$executeRawUnsafe(
        `INSERT INTO "${alvo}" ("id", "username", "password_hash", "ativo")
         VALUES (-1, $1, 'hash-de-teste', true), (-2, $2, 'hash-de-teste', false)`,
        `teste-antigo-ativo-${SUFIXO}`,
        `teste-antigo-inativo-${SUFIXO}`,
      );

      const antes = await tx.$queryRawUnsafe<{ total: bigint }[]>(
        `SELECT count(*)::bigint AS total FROM "${alvo}"`,
      );

      // 3. Roda a migration de verdade, lida do arquivo em disco.
      for (const comando of comandos) {
        await tx.$executeRawUnsafe(comando);
      }

      const porPapel = await tx.$queryRawUnsafe<
        { papel: string; total: bigint }[]
      >(`SELECT "papel", count(*)::bigint AS total FROM "${alvo}" GROUP BY "papel"`);

      // 4. Como a coluna ficou depois da migration — na copia e na tabela de
      //    verdade, que ja levou esta migration pelo `migrate deploy`.
      const coluna = await tx.$queryRawUnsafe<
        { table_name: string; is_nullable: string; column_default: string | null }[]
      >(
        `SELECT c.table_name, c.is_nullable, c.column_default
           FROM information_schema.columns c
          WHERE c.column_name = 'papel'
            AND c.table_name IN ('usuario', $1)`,
        alvo,
      );

      // As duas buscas de CHECK sao escopadas por `conrelid`, e nao so pelo
      // nome: o nome da constraint nao e reescrito junto com o da tabela, entao
      // a copia carrega um `usuario_papel_valido` homonimo (o Postgres so exige
      // nome unico dentro da mesma tabela). Sem o escopo, cada consulta veria
      // as duas.
      const checksDaCopia = await tx.$queryRawUnsafe<{ total: bigint }[]>(
        `SELECT count(*)::bigint AS total
           FROM pg_constraint
          WHERE contype = 'c'
            AND conrelid = $1::regclass
            AND pg_get_constraintdef(oid) ILIKE '%papel%'`,
        alvo,
      );

      const checkDaTabelaReal = await tx.$queryRawUnsafe<{ def: string }[]>(
        `SELECT pg_get_constraintdef(oid) AS def
           FROM pg_constraint
          WHERE conname = 'usuario_papel_valido'
            AND contype = 'c'
            AND conrelid = 'public.usuario'::regclass`,
      );

      return {
        linhas: Number(antes[0].total),
        porPapel: porPapel.map((l) => ({ papel: l.papel, total: Number(l.total) })),
        coluna,
        checksDaCopia: Number(checksDaCopia[0].total),
        checkDaTabelaReal: checkDaTabelaReal.map((l) => l.def),
      };
    });

    // A prova so vale se havia linha para backfillar — as duas inseridas acima
    // garantem isso mesmo num banco vazio.
    expect(resultado.linhas).toBeGreaterThanOrEqual(2);

    // **Toda** linha que existia antes da migration saiu dela como 'admin':
    // um unico grupo, e ele cobre a tabela inteira.
    expect(resultado.porPapel).toEqual([
      { papel: "admin", total: resultado.linhas },
    ]);

    // NOT NULL e **sem** default, nas duas tabelas. Decisao registrada na
    // migration: se alguem reintroduzir o `DEFAULT 'admin'` permanente, ou
    // deixar a coluna nullable, e aqui que cai.
    expect(resultado.coluna).toHaveLength(2);
    for (const coluna of resultado.coluna) {
      expect(coluna.is_nullable).toBe("NO");
      expect(coluna.column_default).toBeNull();
    }

    // O CHECK nasceu com a coluna na copia...
    expect(resultado.checksDaCopia).toBe(1);

    // ...e a tabela `usuario` de verdade carrega o mesmo, com os dois papeis.
    expect(resultado.checkDaTabelaReal).toHaveLength(1);
    expect(resultado.checkDaTabelaReal[0]).toMatch(/'admin'/);
    expect(resultado.checkDaTabelaReal[0]).toMatch(/'recepcao'/);
  });
});

/**
 * A parte que os dois scripts nao compartilham: qual par de variaveis cada um
 * le. Afirmado por leitura do fonte porque executar os scripts de verdade
 * exigiria subir dois processos e escrever no banco fora de transacao — e o que
 * pode dar errado aqui e uma troca de nome no copiar-e-colar, que a leitura
 * pega.
 */
describe("variaveis de ambiente dos scripts de conta", () => {
  const fonte = (nome: string) =>
    readFileSync(
      fileURLToPath(new URL(`../../scripts/${nome}`, import.meta.url)),
      "utf8",
    );

  it("create-admin le ADMIN_* e grava papel admin", () => {
    const codigo = fonte("create-admin.ts");

    expect(codigo).toContain("process.env.ADMIN_USERNAME");
    expect(codigo).toContain("process.env.ADMIN_PASSWORD");
    expect(codigo).toContain('papel: "admin"');
    // `process.env.` na frente de proposito: os dois scripts *citam* o par do
    // outro nos comentarios, explicando por que as variaveis sao separadas. O
    // que nao pode existir e a leitura.
    expect(codigo).not.toMatch(/process\.env\.RECEPCAO_/);
  });

  it("create-recepcao le RECEPCAO_* e grava papel recepcao", () => {
    const codigo = fonte("create-recepcao.ts");

    expect(codigo).toContain("process.env.RECEPCAO_USERNAME");
    expect(codigo).toContain("process.env.RECEPCAO_PASSWORD");
    expect(codigo).toContain('papel: "recepcao"');
    // Nao pode *ler* o par do admin por engano — o motivo de as variaveis
    // serem separadas. Cita-lo em comentario e permitido (e ele cita).
    expect(codigo).not.toMatch(/process\.env\.ADMIN_/);
  });
});

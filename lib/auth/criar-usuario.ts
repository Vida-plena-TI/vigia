/**
 * Criacao/atualizacao idempotente de conta de usuario.
 *
 * Esta e a implementacao unica por tras de `scripts/create-admin.ts` e
 * `scripts/create-recepcao.ts`. Os dois scripts sao so a casca: leem o
 * ambiente, abrem o `PrismaClient` e imprimem o resultado. A regra de
 * idempotencia — "se o username ja existe, redefine a senha e reativa a conta
 * em vez de falhar por duplicata" — mora aqui, para os dois scripts nao
 * poderem divergir em silencio quando um deles for mexido.
 *
 * Sem `server-only`, pelo mesmo motivo de `password.ts`: roda fora do Next.
 *
 * Vive em `lib/` e nao em `scripts/` de proposito: e o que deixa o teste de
 * integracao alcanca-lo pelo `include` do `vitest.config.mts`
 * (`lib/**` + `prisma/**`).
 */
import type { PrismaClient } from "@/lib/generated/prisma/client";

import type { PapelUsuario } from "./papel";
import { hashPassword } from "./password";

/** Piso de tamanho de senha exigido pelos scripts de criacao de conta. */
export const MIN_SENHA = 8;

/**
 * O minimo do cliente Prisma que esta funcao usa.
 *
 * Nao e o `PrismaClient` inteiro para o teste de integracao poder passar o
 * cliente de uma transacao (que nao tem `$connect`/`$transaction`) e desfazer
 * tudo no fim, como fazem os testes de dominio.
 */
export type ClienteDeUsuario = Pick<PrismaClient, "usuario">;

export type ContaCriada = {
  id: number;
  username: string;
  papel: PapelUsuario;
  /** `false` quando o username ainda nao existia e a conta foi criada agora. */
  jaExistia: boolean;
};

/**
 * Cria a conta, ou redefine a senha / reativa / regrava o papel se ela ja
 * existir.
 *
 * O `papel` e reescrito tambem no caminho de atualizacao, e nao so no de
 * criacao. Isso e deliberado: quem roda `create-recepcao` esta dizendo qual
 * conta quer, e a alternativa (preservar o papel gravado) faria o mesmo
 * comando produzir resultados diferentes conforme o que havia no banco. O
 * efeito colateral e que apontar um script para o username do outro papel
 * troca o papel daquela conta — por isso os dois scripts leem variaveis de
 * ambiente distintas (`ADMIN_*` e `RECEPCAO_*`), para nao dar para confundir
 * qual conta esta sendo mexida.
 */
export async function criarOuAtualizarUsuario(
  prisma: ClienteDeUsuario,
  entrada: { username: string; senha: string; papel: PapelUsuario },
): Promise<ContaCriada> {
  const { username, senha, papel } = entrada;

  if (!username.trim()) {
    throw new Error("username vazio.");
  }

  if (senha.length < MIN_SENHA) {
    throw new Error(`Senha com menos de ${MIN_SENHA} caracteres.`);
  }

  const passwordHash = await hashPassword(senha);

  // Consulta o "ja existia" antes do upsert: depois dele nao da mais para
  // distinguir criacao de atualizacao, e essa distincao e o que o script
  // imprime para o operador.
  const existente = await prisma.usuario.findUnique({
    where: { username },
    select: { id: true },
  });

  const usuario = await prisma.usuario.upsert({
    where: { username },
    update: { passwordHash, ativo: true, papel },
    create: { username, passwordHash, ativo: true, papel },
    select: { id: true, username: true, papel: true },
  });

  return {
    id: usuario.id,
    username: usuario.username,
    // O banco garante o conjunto de valores pelo CHECK `usuario_papel_valido`,
    // e este upsert acabou de gravar o papel recebido — a leitura de volta e o
    // mesmo valor.
    papel: usuario.papel as PapelUsuario,
    jaExistia: Boolean(existente),
  };
}

/**
 * Regras de acesso por papel (Fase C).
 *
 * Fonte unica das permissoes. As tres camadas que barram — o `proxy.ts`
 * (otimista, pelo cookie), as paginas/Server Actions (autoritativa, pelo banco)
 * e o menu (conveniencia visual) — leem daqui. Duplicar a lista em qualquer uma
 * delas e como as tres saem de sincronia.
 *
 * Sem `server-only` de proposito, pelo mesmo motivo de `papel.ts`: o `proxy.ts`
 * roda fora do contexto de renderizacao e precisa deste modulo.
 *
 * O desenho e um **allowlist por papel**, nao uma lista de rotas proibidas. A
 * regra de negocio diz que a recepcao acessa *somente* tres telas, e escrever a
 * lista pelo lado do que e permitido faz com que qualquer rota nova (a
 * `/sulamerica` da Fase D, por exemplo) nasca fechada para a recepcao ate
 * alguem decidir o contrario. Uma lista de proibidas nasceria aberta — e o
 * esquecimento seria silencioso.
 */

import type { PapelUsuario } from "./papel";

/**
 * Rotas que a recepcao alcanca. Prefixos: casam o caminho exato e os
 * subcaminhos dele.
 *
 * A raiz "/" esta aqui porque e o destino padrao do login; quem cai nela sendo
 * recepcao e redirecionado para o painel pela propria pagina
 * (`app/(app)/page.tsx`), sem ver a escolha de convenio.
 */
export const ROTAS_DA_RECEPCAO = [
  "/",
  "/klini/dashboard",
  "/klini/atendimentos/novo",
  "/klini/atendimentos/hoje",
] as const;

/**
 * As duas rotas restritas ao `admin`, nomeadas.
 *
 * Elas nao entram em nenhuma lista de "proibidas" — a permissao e decidida pelo
 * allowlist acima. Sao constantes porque a pagina e as Server Actions dela
 * precisam pedir permissao *para a mesma rota*, e uma string digitada duas
 * vezes e uma string que diverge uma vez.
 */
export const ROTA_NOVA_REQUISICAO = "/klini/requisicoes/nova";
export const ROTA_ENCAMINHAMENTOS = "/klini/encaminhamentos";

/** Para onde mandar quem esta autenticado mas nao alcanca a rota pedida. */
export const ROTA_PADRAO_DA_RECEPCAO = "/klini/dashboard";

/**
 * Mensagem devolvida por uma Server Action recusada por papel.
 *
 * Chegar aqui pela interface e impossivel (o menu esconde o link e o proxy
 * redireciona), entao esta frase so aparece para um POST montado a mao ou para
 * uma aba velha aberta antes de o papel mudar. Ela diz o que aconteceu sem
 * sugerir que foi erro de digitacao.
 */
export const MENSAGEM_SEM_PERMISSAO =
  "Seu usuário não tem permissão para esta ação.";

/** Casa o caminho exato ou qualquer subcaminho dele. */
function casaPrefixo(pathname: string, prefixo: string): boolean {
  if (prefixo === "/") {
    return pathname === "/";
  }

  return pathname === prefixo || pathname.startsWith(`${prefixo}/`);
}

/**
 * O papel alcanca a rota?
 *
 * `admin` e irrestrito por definicao — nao ha lista de rotas de admin, e nao
 * deve haver: qualquer rota nova nasce acessivel para ele.
 */
export function podeAcessarRota(
  papel: PapelUsuario,
  pathname: string,
): boolean {
  if (papel === "admin") {
    return true;
  }

  return ROTAS_DA_RECEPCAO.some((rota) => casaPrefixo(pathname, rota));
}

import {
  ROTA_ENCAMINHAMENTOS,
  ROTA_NOVA_REQUISICAO,
  ROTA_SULAMERICA,
  podeAcessarRota,
} from "@/lib/auth/acesso";
import type { PapelUsuario } from "@/lib/auth/papel";

/**
 * Itens da faixa de navegação.
 *
 * Cada convênio tem sua própria lista; "Painel" abre o painel daquele contexto.
 *
 * Mora num módulo separado da `Navegacao` (que é client component) para ser
 * uma função pura, testável sem renderizar React: o teste que garante que a
 * recepção não vê "Nova requisição" nem "Encaminhamentos" é sobre esta lista.
 */
const ITENS_KLINI = [
  { href: "/klini/dashboard", rotulo: "Painel" },
  { href: ROTA_NOVA_REQUISICAO, rotulo: "Nova requisição" },
  { href: "/klini/atendimentos/novo", rotulo: "Lançar atendimento" },
  { href: "/klini/atendimentos/hoje", rotulo: "Atendimentos de hoje" },
  { href: ROTA_ENCAMINHAMENTOS, rotulo: "Encaminhamentos" },
] as const;

const ITENS_SULAMERICA = [
  { href: ROTA_SULAMERICA, rotulo: "Painel" },
] as const;

const MENUS = [
  { prefixo: "/klini", itens: ITENS_KLINI },
  { prefixo: "/sulamerica", itens: ITENS_SULAMERICA },
] as const;

export type ItemDeNavegacao = (typeof MENUS)[number]["itens"][number];

/**
 * Os itens do convênio atual que este papel alcança.
 *
 * Esconder o link é **conveniência**, não proteção: quem digitar a URL na barra
 * de endereço cai no desvio do `proxy.ts`, e quem postar direto na Server
 * Action cai em `autorizarRota()`. O filtro existe para a recepção não ver uma
 * porta que não abre — o mesmo `podeAcessarRota` das outras duas camadas, para
 * menu e permissão não poderem discordar.
 */
export function itensDeNavegacaoPara(
  papel: PapelUsuario,
  caminho: string,
): readonly ItemDeNavegacao[] {
  // O header interno também carrega a query string. Ela não define convênio.
  const pathname = caminho.split(/[?#]/, 1)[0];
  const menu = MENUS.find(
    ({ prefixo }) => pathname === prefixo || pathname.startsWith(`${prefixo}/`),
  );
  return menu?.itens.filter((item) => podeAcessarRota(papel, item.href)) ?? [];
}

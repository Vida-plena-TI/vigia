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
 * Os rótulos batem exatamente com o `<h1>` de cada página — acentuação
 * incluída. Divergir aqui faz o usuário achar que chegou em outro lugar.
 *
 * Mora num módulo separado da `Navegacao` (que é client component) para ser
 * uma função pura, testável sem renderizar React: o teste que garante que a
 * recepção não vê "Nova requisição" nem "Encaminhamentos" é sobre esta lista.
 */
const ITENS = [
  { href: "/klini/dashboard", rotulo: "Painel" },
  { href: ROTA_NOVA_REQUISICAO, rotulo: "Nova requisição" },
  { href: "/klini/atendimentos/novo", rotulo: "Lançar atendimento" },
  { href: "/klini/atendimentos/hoje", rotulo: "Atendimentos de hoje" },
  { href: ROTA_ENCAMINHAMENTOS, rotulo: "Encaminhamentos" },
  { href: ROTA_SULAMERICA, rotulo: "SulAmérica" },
] as const;

export type ItemDeNavegacao = (typeof ITENS)[number];

/**
 * Os itens que este papel alcança.
 *
 * Esconder o link é **conveniência**, não proteção: quem digitar a URL na barra
 * de endereço cai no desvio do `proxy.ts`, e quem postar direto na Server
 * Action cai em `autorizarRota()`. O filtro existe para a recepção não ver uma
 * porta que não abre — o mesmo `podeAcessarRota` das outras duas camadas, para
 * menu e permissão não poderem discordar.
 */
export function itensDeNavegacaoPara(
  papel: PapelUsuario,
): readonly ItemDeNavegacao[] {
  return ITENS.filter((item) => podeAcessarRota(papel, item.href));
}

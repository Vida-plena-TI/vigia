/**
 * As regras de acesso por papel, sozinhas.
 *
 * Este e o unico lugar onde as permissoes sao afirmadas como tabela; as tres
 * camadas que barram (proxy, pagina/action e menu) tem testes proprios, mas
 * todas chamam `podeAcessarRota` — se a regra mudar aqui sem intencao, os tres
 * quebram junto.
 */
import { describe, expect, it } from "vitest";

import {
  ROTAS_DA_RECEPCAO,
  ROTA_ENCAMINHAMENTOS,
  ROTA_NOVA_REQUISICAO,
  podeAcessarRota,
} from "./acesso";

const ROTAS_RESTRITAS = [ROTA_NOVA_REQUISICAO, ROTA_ENCAMINHAMENTOS];

describe("podeAcessarRota — admin", () => {
  it("alcanca todas as rotas que existem hoje", () => {
    for (const rota of [...ROTAS_DA_RECEPCAO, ...ROTAS_RESTRITAS]) {
      expect(podeAcessarRota("admin", rota)).toBe(true);
    }
  });

  it("alcanca tambem rota que ainda nao existe", () => {
    // Nao ha allowlist de admin, e nao deve haver: a rota da Fase D nasce
    // acessivel para ele sem ninguem lembrar de cadastra-la.
    expect(podeAcessarRota("admin", "/sulamerica/dashboard")).toBe(true);
  });
});

describe("podeAcessarRota — recepcao", () => {
  it("alcanca as tres telas dela e a raiz", () => {
    for (const rota of ROTAS_DA_RECEPCAO) {
      expect(podeAcessarRota("recepcao", rota)).toBe(true);
    }
  });

  it("nao alcanca nova requisicao nem encaminhamentos", () => {
    for (const rota of ROTAS_RESTRITAS) {
      expect(podeAcessarRota("recepcao", rota)).toBe(false);
    }
  });

  it("nao alcanca subcaminho das rotas restritas", () => {
    expect(podeAcessarRota("recepcao", "/klini/requisicoes")).toBe(false);
    expect(podeAcessarRota("recepcao", "/klini/encaminhamentos/qualquer")).toBe(
      false,
    );
  });

  it("alcanca subcaminho das rotas dela", () => {
    expect(podeAcessarRota("recepcao", "/klini/dashboard/qualquer")).toBe(true);
  });

  it("nao alcanca rota nova so por ela ainda nao existir", () => {
    // O allowlist e o que garante isto: com lista de proibidas, `/sulamerica`
    // entraria aberto para a recepcao na Fase D sem ninguem decidir.
    expect(podeAcessarRota("recepcao", "/sulamerica/dashboard")).toBe(false);
  });

  it("a raiz casa exata, e nao como prefixo de tudo", () => {
    expect(podeAcessarRota("recepcao", "/")).toBe(true);
    expect(podeAcessarRota("recepcao", "/klini")).toBe(false);
  });
});

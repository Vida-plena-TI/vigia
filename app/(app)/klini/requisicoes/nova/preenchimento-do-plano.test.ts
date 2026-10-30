/**
 * Quando o plano do paciente preenche as linhas de "Nova requisição", quando o
 * formulário só oferece o botão e quando recarrega (regra 26).
 *
 * Só funções puras: o ambiente do Vitest é `node`, sem DOM. O clique fica para
 * o roteiro de navegador do CONTEXT.md.
 */
import { describe, expect, it } from "vitest";

import {
  anuncioDePlanoCarregado,
  carregarPedeConfirmacao,
  chaveDoNome,
  decidirPreenchimento,
  linhaNova,
  linhasDoPlano,
  nomeEstaNaLista,
  QTD_AUTORIZADA_PADRAO,
  situacaoDaLinha,
  temLinhaEditada,
  textoDoPlanoNaLinha,
  type LinhaDoFormulario,
  type TerapiaDoPlanoNoFormulario,
} from "./preenchimento-do-plano";

const VALIDADE = "2026-11-30";

const PLANO_ANA: TerapiaDoPlanoNoFormulario[] = [
  { terapiaId: 1, nome: "Fono", minutosSemanais: 150 },
  { terapiaId: 2, nome: "TO", minutosSemanais: 60 },
];

const PLANO_BRUNO: TerapiaDoPlanoNoFormulario[] = [
  { terapiaId: 3, nome: "Psicologia", minutosSemanais: 45 },
];

function contador(inicio = 100) {
  let proxima = inicio;
  return () => proxima++;
}

function preenchidas(
  plano: TerapiaDoPlanoNoFormulario[] = PLANO_ANA,
): LinhaDoFormulario[] {
  return linhasDoPlano(plano, VALIDADE, [], contador());
}

describe("linhasDoPlano", () => {
  it("cria uma linha por terapia, com a terapia escolhida e os padrões de sempre", () => {
    const linhas = preenchidas();

    expect(linhas.map((linha) => linha.terapiaId)).toEqual(["1", "2"]);
    for (const linha of linhas) {
      expect(linha.qtdAutorizada).toBe(QTD_AUTORIZADA_PADRAO);
      expect(linha.qtdAutorizada).toBe("4");
      expect(linha.validade).toBe(VALIDADE);
    }
  });

  it("não calcula nada a partir do tempo semanal", () => {
    const [curta] = linhasDoPlano(
      [{ terapiaId: 1, nome: "Fono", minutosSemanais: 15 }],
      VALIDADE,
      [],
      contador(),
    );
    const [longa] = linhasDoPlano(
      [{ terapiaId: 1, nome: "Fono", minutosSemanais: 10_080 }],
      VALIDADE,
      [],
      contador(),
    );

    expect(curta.qtdAutorizada).toBe(longa.qtdAutorizada);
    expect(curta.validade).toBe(longa.validade);
  });

  it("reaproveita as chaves atuais na ordem (o foco não se perde) e cria as que faltam", () => {
    const linhas = linhasDoPlano(PLANO_ANA, VALIDADE, [7], contador(50));

    expect(linhas.map((linha) => linha.chave)).toEqual([7, 50]);
  });

  it("plano vazio não cria linha nenhuma", () => {
    expect(linhasDoPlano([], VALIDADE, [1], contador())).toEqual([]);
  });
});

describe("situacaoDaLinha", () => {
  it("linha nova intocada é vazia", () => {
    expect(situacaoDaLinha(linhaNova(0, VALIDADE), VALIDADE)).toBe("vazia");
  });

  it("linha nova com terapia, quantidade ou validade mudada é editada", () => {
    const base = linhaNova(0, VALIDADE);

    expect(situacaoDaLinha({ ...base, terapiaId: "1" }, VALIDADE)).toBe(
      "editada",
    );
    expect(situacaoDaLinha({ ...base, qtdAutorizada: "8" }, VALIDADE)).toBe(
      "editada",
    );
    expect(situacaoDaLinha({ ...base, validade: "" }, VALIDADE)).toBe(
      "editada",
    );
  });

  it("linha do plano intocada é do-plano; mexida é editada (mesmo voltando a terapia para vazio)", () => {
    const [linha] = preenchidas();

    expect(situacaoDaLinha(linha, VALIDADE)).toBe("do-plano");
    expect(situacaoDaLinha({ ...linha, qtdAutorizada: "6" }, VALIDADE)).toBe(
      "editada",
    );
    expect(situacaoDaLinha({ ...linha, validade: "2027-01-01" }, VALIDADE)).toBe(
      "editada",
    );
    expect(situacaoDaLinha({ ...linha, terapiaId: "2" }, VALIDADE)).toBe(
      "editada",
    );
    // Trocar para "Escolha uma terapia" com os padrões intactos é vazia.
    expect(situacaoDaLinha({ ...linha, terapiaId: "" }, VALIDADE)).toBe(
      "vazia",
    );
  });

  it("linha à mão igual a uma do plano continua sendo à mão (editada)", () => {
    const manual = { ...linhaNova(0, VALIDADE), terapiaId: "1" };

    expect(situacaoDaLinha(manual, VALIDADE)).toBe("editada");
  });
});

describe("decidirPreenchimento", () => {
  it("linhas vazias: preenche", () => {
    expect(
      decidirPreenchimento([linhaNova(0, VALIDADE)], VALIDADE, PLANO_ANA),
    ).toBe("preencher");
  });

  it("linhas intocadas do preenchimento, trocando de paciente: recarrega o plano do novo", () => {
    expect(decidirPreenchimento(preenchidas(), VALIDADE, PLANO_BRUNO)).toBe(
      "preencher",
    );
  });

  it("remover linhas preenchidas não conta como edição: as que sobraram são recarregadas", () => {
    const [soFono] = preenchidas();

    expect(decidirPreenchimento([soFono], VALIDADE, PLANO_BRUNO)).toBe(
      "preencher",
    );
  });

  it("linha do plano editada: não apaga, só oferece o botão", () => {
    const [fono, to] = preenchidas();
    const linhas = [{ ...fono, qtdAutorizada: "12" }, to];

    expect(decidirPreenchimento(linhas, VALIDADE, PLANO_BRUNO)).toBe(
      "oferecer",
    );
  });

  it("linha acrescentada à mão: não apaga, só oferece o botão", () => {
    const linhas = [
      ...preenchidas(),
      { ...linhaNova(9, VALIDADE), terapiaId: "5" },
    ];

    expect(decidirPreenchimento(linhas, VALIDADE, PLANO_BRUNO)).toBe(
      "oferecer",
    );
  });

  it("linha à mão antes de escolher o paciente: oferece em vez de preencher", () => {
    const manual = { ...linhaNova(0, VALIDADE), terapiaId: "4" };

    expect(decidirPreenchimento([manual], VALIDADE, PLANO_ANA)).toBe(
      "oferecer",
    );
  });

  it("linha à mão em branco (adicionada e ainda vazia) não impede o preenchimento", () => {
    const linhas = [...preenchidas(), linhaNova(9, VALIDADE)];

    expect(decidirPreenchimento(linhas, VALIDADE, PLANO_BRUNO)).toBe(
      "preencher",
    );
  });

  it("novo paciente sem plano depois de um preenchimento intocado: limpa", () => {
    expect(decidirPreenchimento(preenchidas(), VALIDADE, [])).toBe("limpar");
  });

  it("paciente sem plano com linhas vazias: mantém", () => {
    expect(decidirPreenchimento([linhaNova(0, VALIDADE)], VALIDADE, [])).toBe(
      "manter",
    );
  });

  it("paciente sem plano com linhas editadas: mantém (não apaga trabalho)", () => {
    const [fono, to] = preenchidas();

    expect(
      decidirPreenchimento([{ ...fono, validade: "" }, to], VALIDADE, []),
    ).toBe("manter");
  });
});

describe("Carregar plano do paciente", () => {
  it("pede confirmação só quando há linha editada à mão", () => {
    expect(carregarPedeConfirmacao([linhaNova(0, VALIDADE)], VALIDADE)).toBe(
      false,
    );
    expect(carregarPedeConfirmacao(preenchidas(), VALIDADE)).toBe(false);

    const [fono, to] = preenchidas();
    expect(
      carregarPedeConfirmacao([{ ...fono, qtdAutorizada: "2" }, to], VALIDADE),
    ).toBe(true);
    expect(
      carregarPedeConfirmacao(
        [{ ...linhaNova(0, VALIDADE), terapiaId: "1" }],
        VALIDADE,
      ),
    ).toBe(true);
  });

  it("temLinhaEditada olha todas as linhas", () => {
    const linhas = [...preenchidas(), { ...linhaNova(9, VALIDADE), qtdAutorizada: "1" }];

    expect(temLinhaEditada(linhas, VALIDADE)).toBe(true);
    expect(temLinhaEditada(preenchidas(), VALIDADE)).toBe(false);
  });
});

describe("quando consultar", () => {
  const lista = new Set(["ana souza", "josé silva"].map(chaveDoNome));

  it("compara sem caixa e sem espaço nas pontas", () => {
    expect(nomeEstaNaLista("  ANA Souza ", lista)).toBe(true);
    expect(nomeEstaNaLista("JOSÉ SILVA", lista)).toBe(true);
  });

  it("nome parcial, vazio ou fora da lista não consulta durante a digitação", () => {
    expect(nomeEstaNaLista("Ana", lista)).toBe(false);
    expect(nomeEstaNaLista("   ", lista)).toBe(false);
    expect(nomeEstaNaLista("Carlos", lista)).toBe(false);
  });
});

describe("textos", () => {
  it("referência da linha usa formatarMinutosSemanais", () => {
    expect(textoDoPlanoNaLinha(150)).toBe("Plano: 2 h 30 min por semana");
    expect(textoDoPlanoNaLinha(45)).toBe("Plano: 45 min por semana");
    expect(textoDoPlanoNaLinha(120)).toBe("Plano: 2 h por semana");
  });

  it("anúncio diz quantas terapias entraram", () => {
    expect(anuncioDePlanoCarregado(2)).toBe("Plano carregado: 2 terapias.");
    expect(anuncioDePlanoCarregado(1)).toBe("Plano carregado: 1 terapia.");
  });
});

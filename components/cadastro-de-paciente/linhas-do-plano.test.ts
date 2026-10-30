/**
 * As linhas do formulário da aba Cadastro com a caixa "Tempo por semana"
 * (30/10/2026): linha nova nasce com 30 minutos, o "Editar" abre cada linha
 * com o tempo gravado (sem aplicar o padrão) e cada caminho envia no campo
 * `horas` o texto que o servidor já aceita.
 *
 * Renderizado para HTML estático (o ambiente do Vitest é `node`): troca de
 * opção, foco no "Horas" e teclado ficam para o roteiro manual.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// As actions puxariam sessão e banco; a renderização não as chama.
vi.mock("@/lib/domain/plano-terapias-actions", () => ({
  cadastrarPacienteAction: vi.fn(),
}));
vi.mock("@/lib/domain/pacientes-actions", () => ({
  contarParaExcluirPaciente: vi.fn(),
  excluirPaciente: vi.fn(),
}));

import {
  ERRO_TEMPO_ACIMA_DO_LIMITE,
  ERRO_TEMPO_NAO_POSITIVO,
  ERRO_TEMPO_OBRIGATORIO,
  ERRO_TERAPIA_OBRIGATORIA,
} from "@/lib/domain/plano-terapias-mensagens";
import {
  type EstadoDoTempo,
  horasParaEnvio,
  lerHorasSemanais,
} from "@/lib/domain/tempo-semanal";

import {
  type LinhaDoFormulario,
  linhasDoPlanoGravado,
  novaLinha,
  validarFormulario,
} from "./linhas-do-plano";
import { LinhaDoPlano, TelaDeCadastro } from "./tela-de-cadastro";

const TERAPIAS = [
  { id: 1, nome: "Fono", codigoTiss: "1" },
  { id: 2, nome: "TO", codigoTiss: "2" },
];

const terapiaDoPlano = (terapiaId: number, minutosSemanais: number) => ({
  terapiaId,
  terapiaNome: terapiaId === 1 ? "Fono" : "TO",
  minutosSemanais,
});

function renderizarLinha(linha: LinhaDoFormulario, temErro = false) {
  return renderToStaticMarkup(
    createElement(LinhaDoPlano, {
      linha,
      indice: 0,
      terapias: TERAPIAS,
      escolhidas: new Set([linha.terapiaId].filter(Boolean)),
      podeRemover: true,
      temErro,
      aoAlterar: () => {},
      aoRemover: () => {},
    }),
  );
}

/** O `value` do campo escondido `horas`: o que a linha envia. */
function horasEnviadas(html: string): string | undefined {
  return /<input type="hidden" name="horas" value="([^"]*)"/.exec(html)?.[1];
}

/** O texto da opção marcada da caixa de tempo (o `select` de id plano-tempo-). */
function opcaoMarcada(html: string): string | undefined {
  const caixa = /<select id="plano-tempo-\d+"[^>]*>(.*?)<\/select>/.exec(html)?.[1];
  return caixa && /<option[^>]* selected="">([^<]*)<\/option>/.exec(caixa)?.[1];
}

describe("linha nova", () => {
  it("nasce sem terapia e com 30 minutos escolhidos", () => {
    const linha = novaLinha();

    expect(linha.terapiaId).toBe("");
    expect(linha.tempo).toEqual({ tipo: "pronta", minutos: 30 });
    expect(horasParaEnvio(linha.tempo)).toBe("0,5");
  });

  it("cada linha tem o próprio estado (Adicionar terapia não compartilha objeto)", () => {
    const a = novaLinha();
    const b = novaLinha();

    expect(a.chave).not.toBe(b.chave);
    expect(a.tempo).not.toBe(b.tempo);
  });

  it("a primeira linha da tela já mostra 30 minutos e envia 0,5", () => {
    const html = renderToStaticMarkup(
      createElement(TelaDeCadastro, {
        convenio: "klini",
        terapias: TERAPIAS,
        pacientes: [],
      }),
    );

    expect(opcaoMarcada(html)).toBe("30 minutos");
    expect(horasEnviadas(html)).toBe("0,5");
    // O campo antigo, de texto em horas, saiu.
    expect(html).not.toContain('inputMode="decimal"');
    expect(html).not.toContain("Digite em horas");
  });
});

describe("caixa Tempo por semana", () => {
  it("é um select nativo com rótulo visível, as opções na ordem e o nome da terapia para o leitor de tela", () => {
    const html = renderizarLinha(novaLinha("1"));
    const chave = /id="plano-tempo-(\d+)"/.exec(html)?.[1];

    expect(html).toContain(`<label`);
    expect(html).toMatch(new RegExp(`for="plano-tempo-${chave}"[^>]*>Tempo por semana<`));
    expect(html).toContain(
      `aria-describedby="plano-tempo-terapia-${chave} tempo-apoio"`,
    );
    expect(html).toContain(
      `<span id="plano-tempo-terapia-${chave}" class="sr-only">Terapia 1: Fono.</span>`,
    );
    const rotulos = [
      ...(
        /<select id="plano-tempo-\d+"[^>]*>(.*?)<\/select>/.exec(html)?.[1] ?? ""
      ).matchAll(/<option[^>]*>([^<]*)<\/option>/g),
    ].map((m) => m[1]);
    expect(rotulos).toEqual([
      "30 minutos",
      "1 hora",
      "1 hora e meia",
      "2 horas",
      "2 horas e meia",
      "Outro (digitar)",
    ]);
    // 40px abaixo de sm.
    expect(html).toMatch(/<select id="plano-tempo-\d+" class="h-10 sm:h-9 /);
  });

  it("sem terapia escolhida, o leitor de tela ouve que ainda não foi escolhida", () => {
    expect(renderizarLinha(novaLinha())).toContain(
      "Terapia 1: ainda não escolhida.",
    );
  });

  it.each([
    [30, "30 minutos", "0,5"],
    [60, "1 hora", "1"],
    [90, "1 hora e meia", "1,5"],
    [120, "2 horas", "2"],
    [150, "2 horas e meia", "2,5"],
  ])("opção pronta de %i min mostra %j e envia %j, sem os campos do Outro", (minutos, rotulo, enviado) => {
    const html = renderizarLinha(novaLinha("1", { tipo: "pronta", minutos }));

    expect(opcaoMarcada(html)).toBe(rotulo);
    expect(horasEnviadas(html)).toBe(enviado);
    expect(html).not.toContain(">Horas<");
    expect(html).not.toContain(">Minutos<");
  });

  it.each([
    [{ tipo: "outro", horas: "3", minutos: 30 } as EstadoDoTempo, "3,5", "3 h 30 min por semana"],
    [{ tipo: "outro", horas: "4", minutos: 0 } as EstadoDoTempo, "4", "4 h por semana"],
    [{ tipo: "outro", horas: "0", minutos: 45 } as EstadoDoTempo, "0,75", "45 min por semana"],
  ])("Outro %j envia %j e mostra %j", (tempo, enviado, porExtenso) => {
    const html = renderizarLinha(novaLinha("1", tempo));

    expect(opcaoMarcada(html)).toBe("Outro (digitar)");
    expect(html).toContain(">Horas<");
    expect(html).toContain(">Minutos<");
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain(porExtenso);
    expect(horasEnviadas(html)).toBe(enviado);
    expect(lerHorasSemanais(enviado).ok).toBe(true);
  });

  it("Outro recém-escolhido: horas vazias, minutos 0, nada por extenso e nada enviado", () => {
    const html = renderizarLinha(
      novaLinha("1", { tipo: "outro", horas: "", minutos: 0 }),
    );

    expect(html).toMatch(/<input[^>]*id="plano-horas-\d+"[^>]*value=""/);
    expect(html).toMatch(/<option value="0" selected="">0<\/option>/);
    expect(html).not.toContain("por semana</p>");
    expect(horasEnviadas(html)).toBe("");
  });

  it("os campos do Outro não têm name: só o campo escondido horas viaja", () => {
    const html = renderizarLinha(
      novaLinha("1", { tipo: "outro", horas: "3", minutos: 15 }),
    );

    expect([...html.matchAll(/name="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "terapiaId",
      "horas",
    ]);
  });
});

describe("Editar (plano gravado)", () => {
  it("cada linha abre com o tempo gravado, sem o padrão de 30 minutos", () => {
    const linhas = linhasDoPlanoGravado([
      terapiaDoPlano(1, 120),
      terapiaDoPlano(2, 195),
    ]);

    expect(linhas.map((linha) => [linha.terapiaId, linha.tempo])).toEqual([
      ["1", { tipo: "pronta", minutos: 120 }],
      ["2", { tipo: "outro", horas: "3", minutos: 15 }],
    ]);
    expect(linhas.map((linha) => horasParaEnvio(linha.tempo))).toEqual([
      "2",
      "3,25",
    ]);
  });

  it("plano antigo de 30 minutos abre na opção 30 minutos", () => {
    const [linha] = linhasDoPlanoGravado([terapiaDoPlano(1, 30)]);

    expect(opcaoMarcada(renderizarLinha(linha))).toBe("30 minutos");
  });

  it("plano antigo de 3 h 15 min abre como Outro, com 3 e 15 preenchidos", () => {
    const [linha] = linhasDoPlanoGravado([terapiaDoPlano(1, 195)]);
    const html = renderizarLinha(linha);

    expect(opcaoMarcada(html)).toBe("Outro (digitar)");
    expect(html).toMatch(/<input[^>]*id="plano-horas-\d+"[^>]*value="3"/);
    expect(html).toMatch(/<option value="15" selected="">15<\/option>/);
    expect(html).toContain("3 h 15 min por semana");
    expect(horasEnviadas(html)).toBe("3,25");
  });

  it.each([15, 45, 60, 135, 600, 10080])(
    "salvar sem mexer regrava os mesmos %i min",
    (minutos) => {
      const [linha] = linhasDoPlanoGravado([terapiaDoPlano(1, minutos)]);

      expect(validarFormulario("Fulano", [linha])).toBeNull();
      expect(lerHorasSemanais(horasParaEnvio(linha.tempo))).toEqual({
        ok: true,
        minutos,
      });
    },
  );

  it("paciente sem plano abre com uma linha nova (essa sim com 30 minutos)", () => {
    const linhas = linhasDoPlanoGravado([]);

    expect(linhas).toHaveLength(1);
    expect(linhas[0].terapiaId).toBe("");
    expect(linhas[0].tempo).toEqual({ tipo: "pronta", minutos: 30 });
  });
});

describe("validarFormulario", () => {
  it("linha nova com terapia passa sem tocar no tempo", () => {
    expect(validarFormulario("Fulano", [novaLinha("1")])).toBeNull();
  });

  it("linha nova sem terapia ainda pede a terapia", () => {
    expect(validarFormulario("Fulano", [novaLinha()])).toEqual({
      erro: ERRO_TERAPIA_OBRIGATORIA,
      linha: 0,
    });
  });

  it.each([
    [{ tipo: "outro", horas: "", minutos: 0 } as EstadoDoTempo, ERRO_TEMPO_OBRIGATORIO],
    [{ tipo: "outro", horas: "0", minutos: 0 } as EstadoDoTempo, ERRO_TEMPO_NAO_POSITIVO],
    [{ tipo: "outro", horas: "168", minutos: 15 } as EstadoDoTempo, ERRO_TEMPO_ACIMA_DO_LIMITE],
  ])("Outro %j aponta a linha", (tempo, erro) => {
    expect(
      validarFormulario("Fulano", [novaLinha("1"), novaLinha("2", tempo)]),
    ).toEqual({ erro, linha: 1 });
  });
});

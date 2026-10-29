import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { AvisoDeErroDoEncaminhamento } from "@/components/aviso-de-erro-do-encaminhamento";
import {
  ERRO_PACIENTE_DE_OUTRO_CONVENIO,
  ERRO_PACIENTE_FORA_DO_CADASTRO,
  ERRO_PACIENTE_SEM_CONVENIO,
  ehErroDoPacienteDoEncaminhamento,
  ehErroQueLevaAoCadastro,
} from "@/lib/domain/pacientes-mensagens";

import { SEM_PLANO, resumirPlano } from "./resumo-do-plano";

describe("resumirPlano", () => {
  it("junta as terapias na ordem recebida, com o tempo formatado", () => {
    expect(
      resumirPlano([
        { terapiaNome: "Fono", minutosSemanais: 120 },
        { terapiaNome: "TO", minutosSemanais: 90 },
      ]),
    ).toBe("Fono 2 h · TO 1 h 30 min");
  });

  it("sem plano devolve null, que a tela mostra como 'Plano não cadastrado'", () => {
    expect(resumirPlano([])).toBeNull();
    expect(SEM_PLANO).toBe("Plano não cadastrado");
  });
});

describe("recusa do encaminhamento por paciente (regra 24)", () => {
  it("a frase do nome inexistente é a combinada", () => {
    expect(ERRO_PACIENTE_FORA_DO_CADASTRO).toBe(
      "Paciente não cadastrado. Cadastre primeiro em Cadastro.",
    );
  });

  it("nome inexistente e paciente sem convênio levam ao Cadastro; outro convênio não", () => {
    expect(ehErroQueLevaAoCadastro(ERRO_PACIENTE_FORA_DO_CADASTRO)).toBe(true);
    expect(ehErroQueLevaAoCadastro(ERRO_PACIENTE_SEM_CONVENIO)).toBe(true);
    expect(ehErroQueLevaAoCadastro(ERRO_PACIENTE_DE_OUTRO_CONVENIO)).toBe(false);
    expect(ehErroQueLevaAoCadastro("Informe o CRM do médico.")).toBe(false);
    for (const erro of [
      ERRO_PACIENTE_FORA_DO_CADASTRO,
      ERRO_PACIENTE_SEM_CONVENIO,
      ERRO_PACIENTE_DE_OUTRO_CONVENIO,
    ]) {
      expect(ehErroDoPacienteDoEncaminhamento(erro)).toBe(true);
    }
  });

  it.each([
    ["/klini/pacientes"],
    ["/sulamerica/pacientes"],
  ])("o aviso traz o link para a aba Cadastro do convênio (%s)", (rota) => {
    const html = renderToStaticMarkup(
      createElement(AvisoDeErroDoEncaminhamento, {
        erro: ERRO_PACIENTE_FORA_DO_CADASTRO,
        rotaDoCadastro: rota,
      }),
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain(ERRO_PACIENTE_FORA_DO_CADASTRO);
    expect(html).toMatch(new RegExp(`<a[^>]*href="${rota}"[^>]*>Ir para Cadastro</a>`));
  });

  it("o aviso de outro convênio não traz link", () => {
    const html = renderToStaticMarkup(
      createElement(AvisoDeErroDoEncaminhamento, {
        erro: ERRO_PACIENTE_DE_OUTRO_CONVENIO,
        rotaDoCadastro: "/klini/pacientes",
      }),
    );

    expect(html).not.toContain("<a");
  });
});

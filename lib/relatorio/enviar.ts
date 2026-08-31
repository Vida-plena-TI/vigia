import type { PacienteDoRelatorioSemanal } from "./montar";

const RESEND_EMAILS_URL = "https://api.resend.com/emails";

export type ResultadoEnvioRelatorioSemanal =
  | { enviado: false; motivo: "sem-pacientes" }
  | { enviado: true; id: string | null };

type ConfiguracaoDeEmail = {
  apiKey: string;
  from: string;
  to: string[];
};

function variavelObrigatoria(nome: string): string {
  const valor = process.env[nome]?.trim();

  if (!valor) {
    throw new Error(`${nome} não configurada.`);
  }

  return valor;
}

function lerConfiguracaoDeEmail(): ConfiguracaoDeEmail {
  const to = variavelObrigatoria("REPORT_EMAIL_TO")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);

  if (to.length === 0) {
    throw new Error("REPORT_EMAIL_TO não configurada.");
  }

  return {
    apiKey: variavelObrigatoria("RESEND_API_KEY"),
    from: variavelObrigatoria("REPORT_EMAIL_FROM"),
    to,
  };
}

function escaparHtml(valor: string | number | null | undefined): string {
  return String(valor ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function montarHtmlDoRelatorioSemanal(
  pacientes: readonly PacienteDoRelatorioSemanal[],
): string {
  const linhas = pacientes
    .flatMap((paciente) =>
      paciente.guias.map((guia) => {
        const guiaTexto = `${guia.terapiaNome} - requisição ${guia.numeroRequisicao}`;

        return `
          <tr>
            <td>${escaparHtml(paciente.nome)}</td>
            <td>${escaparHtml(guiaTexto)}</td>
            <td>${escaparHtml(guia.statusAlerta)}</td>
          </tr>
        `;
      }),
    )
    .join("");

  return `<!doctype html>
<html lang="pt-BR">
  <body style="font-family: Arial, sans-serif; color: #111827;">
    <h1 style="font-size: 20px; margin: 0 0 12px;">Relatório semanal de guias</h1>
    <p style="margin: 0 0 16px;">
      Pacientes com pelo menos uma guia para renovar ou esgotada.
    </p>
    <table style="border-collapse: collapse; width: 100%;">
      <thead>
        <tr>
          <th align="left" style="border-bottom: 1px solid #d1d5db; padding: 8px;">Paciente</th>
          <th align="left" style="border-bottom: 1px solid #d1d5db; padding: 8px;">Guia</th>
          <th align="left" style="border-bottom: 1px solid #d1d5db; padding: 8px;">Status</th>
        </tr>
      </thead>
      <tbody>${linhas}</tbody>
    </table>
  </body>
</html>`;
}

export async function enviarRelatorioSemanal(
  pacientes: readonly PacienteDoRelatorioSemanal[],
): Promise<ResultadoEnvioRelatorioSemanal> {
  if (pacientes.length === 0) {
    return { enviado: false, motivo: "sem-pacientes" };
  }

  const configuracao = lerConfiguracaoDeEmail();
  const resposta = await fetch(RESEND_EMAILS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${configuracao.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: configuracao.from,
      to: configuracao.to,
      subject: "VIGIA - Relatório semanal de guias",
      html: montarHtmlDoRelatorioSemanal(pacientes),
    }),
  });

  if (!resposta.ok) {
    const corpo = await resposta.text().catch(() => "");

    throw new Error(
      `Falha ao enviar relatório semanal pelo Resend (${resposta.status}): ${
        corpo || resposta.statusText
      }`,
    );
  }

  const dados = (await resposta.json().catch(() => null)) as {
    id?: unknown;
  } | null;

  return {
    enviado: true,
    id: typeof dados?.id === "string" ? dados.id : null,
  };
}

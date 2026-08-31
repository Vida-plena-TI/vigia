import type { NextRequest } from "next/server";

import { enviarRelatorioSemanal } from "@/lib/relatorio/enviar";
import { montarRelatorioSemanal } from "@/lib/relatorio/montar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function respostaNaoAutorizada(): Response {
  return Response.json({ ok: false, erro: "Não autorizado." }, { status: 401 });
}

function segredoDoCron(): string | null {
  return process.env.CRON_SECRET?.trim() || null;
}

export async function GET(request: NextRequest): Promise<Response> {
  const authorization = request.headers.get("authorization");

  if (!authorization) {
    return respostaNaoAutorizada();
  }

  const segredo = segredoDoCron();

  if (!segredo) {
    return Response.json(
      { ok: false, erro: "CRON_SECRET não configurado." },
      { status: 500 },
    );
  }

  if (authorization !== `Bearer ${segredo}`) {
    return respostaNaoAutorizada();
  }

  const pacientes = await montarRelatorioSemanal();
  const envio = await enviarRelatorioSemanal(pacientes);

  return Response.json({
    ok: true,
    pacientes: pacientes.length,
    enviado: envio.enviado,
    emailId: envio.enviado ? envio.id : null,
  });
}

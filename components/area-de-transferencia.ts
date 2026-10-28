/**
 * Escrever texto na área de transferência, com plano B.
 *
 * O caminho de sempre é `navigator.clipboard.writeText`. Ele não existe fora de
 * contexto seguro (o sistema aberto por `http://` num IP da rede da clínica,
 * por exemplo) e pode ser recusado pelo navegador (permissão, aba sem foco).
 * Nos dois casos ainda resta o `document.execCommand("copy")` sobre um
 * `textarea` temporário — obsoleto, mas é o que funciona justamente onde o
 * caminho novo não funciona. Se os dois falharem, quem chama avisa a pessoa.
 *
 * Fica fora do hook, sem React, para dar teste no ambiente `node` do Vitest: o
 * ambiente entra por parâmetro, e o teste passa dublês de `navigator` e
 * `document`.
 */

type AmbienteDeCopia = {
  navigator?: Pick<Navigator, "clipboard">;
  document?: Pick<Document, "createElement" | "body" | "execCommand">;
};

/** `true` se o texto chegou à área de transferência por um dos dois caminhos. */
export async function escreverNaAreaDeTransferencia(
  texto: string,
  ambiente: AmbienteDeCopia = {
    navigator: globalThis.navigator,
    document: globalThis.document,
  },
): Promise<boolean> {
  const clipboard = ambiente.navigator?.clipboard;

  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(texto);
      return true;
    } catch {
      // Recusado: tenta o caminho antigo antes de desistir.
    }
  }

  return copiarPeloDocumento(texto, ambiente.document);
}

function copiarPeloDocumento(
  texto: string,
  documento: AmbienteDeCopia["document"],
): boolean {
  if (!documento?.body || typeof documento.execCommand !== "function") {
    return false;
  }

  const campo = documento.createElement("textarea");
  campo.value = texto;
  // Fora da tela e sem teclado virtual: o campo só existe pelo tempo da cópia.
  campo.setAttribute("readonly", "");
  campo.style.position = "fixed";
  campo.style.top = "-1000px";
  campo.style.opacity = "0";

  documento.body.appendChild(campo);

  try {
    campo.select();
    return documento.execCommand("copy");
  } catch {
    return false;
  } finally {
    documento.body.removeChild(campo);
  }
}

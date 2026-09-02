import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Serif } from "next/font/google";
import "./globals.css";

/**
 * IBM Plex Sans carrega o sistema inteiro: foi desenhada para interface
 * técnica densa, tem algarismo tabular de verdade (`tnum`) e não colapsa a
 * 12px, que é onde vive a maior parte desta aplicação.
 */
const plexSans = IBM_Plex_Sans({
  variable: "--fonte-texto",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

/**
 * A serifada aparece em exatamente dois lugares: o logotipo "VIGIA" e os três
 * contadores do resumo de status. São "a face do instrumento" — o nome dele e
 * a leitura de ponteiro. Nunca abaixo de 1,75rem, nunca em texto corrido,
 * nunca em número de tabela. É da mesma superfamília da sans de propósito,
 * para o par não parecer acidente.
 */
const plexSerif = IBM_Plex_Serif({
  variable: "--fonte-instrumento",
  subsets: ["latin", "latin-ext"],
  weight: ["600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "VIGIA",
  description: "Controle de autorizações de terapia.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${plexSans.variable} ${plexSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

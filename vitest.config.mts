import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const raiz = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // Mesmo alias do tsconfig ("@/*" -> raiz do projeto).
      { find: /^@\//, replacement: `${raiz.replace(/[\/]$/, "")}/` },
      // `server-only` so exporta o modulo vazio na condicao "react-server", que
      // o Next resolve e o Vitest nao. Sem isto, qualquer teste que importe um
      // modulo marcado como servidor (`lib/auth/current-user.ts`) falha no
      // import com "cannot be imported from a Client Component module".
      {
        find: /^server-only$/,
        replacement: `${raiz.replace(/[/]$/, "")}/node_modules/server-only/empty.js`,
      },
    ],
  },
  test: {
    environment: "node",
    // `app/` entra pelos modulos puros que moram junto da UI (a lista de itens
    // do menu, por exemplo). Componente React nao e testado aqui: o ambiente e
    // `node`, sem DOM.
    include: ["lib/**/*.test.ts", "prisma/**/*.test.ts", "app/**/*.test.ts"],
    // O teste de integracao precisa de DATABASE_URL, que vive no .env (nao
    // versionado). Sem .env o setup e inofensivo e o teste se auto-pula.
    setupFiles: ["dotenv/config"],
  },
});

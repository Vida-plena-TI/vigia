import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const raiz = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    // Mesmo alias do tsconfig ("@/*" -> raiz do projeto).
    alias: [{ find: /^@\//, replacement: `${raiz.replace(/[\/]$/, "")}/` }],
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "prisma/**/*.test.ts"],
    // O teste de integracao precisa de DATABASE_URL, que vive no .env (nao
    // versionado). Sem .env o setup e inofensivo e o teste se auto-pula.
    setupFiles: ["dotenv/config"],
  },
});

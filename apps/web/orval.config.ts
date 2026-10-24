import { defineConfig } from "orval";
export default defineConfig({
  wms: {
    input: "../../openapi.json",
    output: {
      target: "./src/shared/api/generated/client.ts",
      schemas: "./src/shared/api/generated/model",
      client: "fetch",
      clean: true,
      override: {
        mutator: { path: "./src/shared/api/transport.ts", name: "apiFetch" },
        fetch: { includeHttpResponseReturnType: false },
      },
    },
  },
});

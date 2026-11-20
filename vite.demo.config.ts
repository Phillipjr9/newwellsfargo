import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config";
import { demoApi } from "./server/api.mjs";
import { adminApi } from "./server/api.mjs";
import { publicPageApi } from "./server/public-pages.mjs";

export default mergeConfig(
  base,
  defineConfig({
    server: { allowedHosts: [".arena.site"] },
    preview: { allowedHosts: [".arena.site"] },
    plugins: [
      {
        name: "isolated-demo-workspaces",
        configureServer(server) {
          server.middlewares.use(publicPageApi);
          server.middlewares.use(adminApi);
          server.middlewares.use(demoApi);
        },
        configurePreviewServer(server) {
          server.middlewares.use(publicPageApi);
          server.middlewares.use(adminApi);
          server.middlewares.use(demoApi);
        },
      },
    ],
  }),
);

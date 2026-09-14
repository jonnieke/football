import { initializeAdmin } from "./runtime.js";
const app = await initializeAdmin();
await app.listen({
  host: process.env.ADMIN_HOST ?? "127.0.0.1",
  port: Number(process.env.ADMIN_PORT ?? 3001),
});
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    void app.close();
  });

import Fastify from "fastify";

const app = Fastify({ logger: true });
app.get("/health", () => ({
  status: "healthy",
  application: "admin-placeholder",
}));
await app.listen({
  host: "0.0.0.0",
  port: Number(process.env.ADMIN_PORT ?? 3001),
});

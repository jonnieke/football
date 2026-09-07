import type { ApiClient } from "@fcp/database";

declare module "fastify" {
  interface FastifyRequest {
    apiClient: Pick<ApiClient, "id" | "name" | "slug" | "rateLimit"> | null;
    startedAtMs: number;
  }
}

import type { IncomingMessage, ServerResponse } from "node:http";
import { initializeAdmin } from "./runtime.js";

export function createAdminHandler(initialize = initializeAdmin) {
  let application: ReturnType<typeof initialize> | undefined;
  return async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    try {
      application ??= initialize().catch((error: unknown) => {
        application = undefined;
        throw error;
      });
      const app = await application;
      app.server.emit("request", request, response);
    } catch {
      console.error(
        JSON.stringify({
          component: "admin",
          code: "ADMIN_INITIALIZATION_FAILED",
        }),
      );
      response.statusCode = 503;
      response.setHeader("Content-Type", "application/json");
      response.setHeader("Cache-Control", "no-store");
      response.end(
        JSON.stringify({
          error: "Administrator service unavailable; retry later",
        }),
      );
    }
  };
}
export default createAdminHandler();

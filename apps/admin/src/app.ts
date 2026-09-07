import Fastify from "fastify";
import { z, ZodError } from "zod";
import { recipientChangeSchema } from "@fcp/database";
import { adminAuth, secret, sendLogin, type AuthRedis } from "./auth.js";
import type { AdminConfig } from "./config.js";
import { page, stylesheet, browserScript } from "./ui.js";

export interface RecipientStore {
  list(after?: string): Promise<unknown>;
  change(input: unknown): Promise<unknown>;
  history(id: string): Promise<unknown>;
}
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export function buildAdmin(deps: {
  config: AdminConfig;
  redis: AuthRedis;
  store: RecipientStore;
  send?: (email: string, token: string) => Promise<void>;
}) {
  const { config, redis, store } = deps;
  const auth = adminAuth(redis, config);
  // No automatic request logs: even malicious query strings must not leak credentials.
  const app = Fastify({ logger: false, trustProxy: false, bodyLimit: 16384 });
  const sessionName = config.secure ? "__Host-fcp_admin" : "fcp_admin";
  const browserName = config.secure ? "__Host-fcp_login" : "fcp_login";
  const cookie = (name: string, value: string, seconds: number) =>
    `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${config.secure ? "; Secure" : ""}`;
  const readCookie = (header: string | undefined, name: string) => {
    const entries = (header ?? "")
      .split(";")
      .map((entry) => entry.trim())
      .filter((entry) => entry.startsWith(`${name}=`));
    return entries.length === 1
      ? entries[0]!.slice(name.length + 1)
      : undefined;
  };
  app.addHook("onRequest", async (request, reply) => {
    void reply.headers({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy":
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    });
    if (request.method !== "GET" && request.method !== "HEAD") {
      if (
        request.headers.origin !== config.origin ||
        request.headers["x-admin-request"] !== "1"
      )
        throw new HttpError(403, "Request origin rejected");
      if (
        request.headers["content-type"]?.split(";")[0]?.trim() !==
        "application/json"
      )
        throw new HttpError(415, "JSON required");
    }
    if (request.url.startsWith("/api/") || request.url.startsWith("/auth/")) {
      if (!(await auth.limit("requests", request.ip, 120, 60)))
        throw new HttpError(429, "Too many requests; try again later");
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    const status =
      error instanceof HttpError
        ? error.status
        : error instanceof ZodError
          ? 400
          : 503;
    if (status === 503)
      console.error(
        JSON.stringify({ component: "admin", code: "ADMIN_REQUEST_FAILED" }),
      );
    if (status === 429) void reply.header("Retry-After", 600);
    void reply.status(status).send({
      error:
        error instanceof HttpError
          ? error.message
          : status === 400
            ? "Invalid request"
            : "Service unavailable; retry later",
    });
  });
  app.get("/health", () => ({ status: "healthy", application: "admin" }));
  for (const path of ["/", "/login", "/auth/confirm", "/settings"])
    app.get(path, (_request, reply) => reply.type("text/html").send(page));
  app.get("/admin.css", (_request, reply) =>
    reply.type("text/css").send(stylesheet),
  );
  app.get("/admin.js", (_request, reply) =>
    reply.type("application/javascript").send(browserScript),
  );
  app.post("/auth/request", async (request, reply) => {
    const { email } = z
      .object({
        email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
      })
      .strict()
      .parse(request.body);
    if (!(await auth.limit("login-ip", request.ip, 10, 600)))
      throw new HttpError(429, "Too many requests; try again later");
    const permitted = await auth.limit("login-email", email, 3, 600);
    const global = await auth.limit("login-global", "all", 60, 600);
    const browser = secret();
    void reply.header("Set-Cookie", cookie(browserName, browser, 600));
    if (permitted && global && config.admins.has(email)) {
      const token = await auth.issue(email, browser);
      try {
        await (
          deps.send ?? ((address, value) => sendLogin(config, address, value))
        )(email, token);
      } catch {
        await auth.cancel(token);
        console.error(
          JSON.stringify({
            component: "admin",
            code: "ADMIN_LOGIN_EMAIL_FAILED",
          }),
        );
      }
    }
    return {
      message:
        "If this address is approved, a sign-in link will arrive. Open it in this browser within 10 minutes.",
    };
  });
  app.post("/auth/redeem", async (request, reply) => {
    const { token } = z
      .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
      .strict()
      .parse(request.body);
    const session = await auth.redeem(
      token,
      readCookie(request.headers.cookie, browserName) ?? "",
    );
    if (!session)
      throw new HttpError(
        401,
        "Link expired, already used, or opened in a different browser. Request a new link.",
      );
    await auth.logout(readCookie(request.headers.cookie, sessionName));
    void reply.header("Set-Cookie", [
      cookie(sessionName, session, 28800),
      cookie(browserName, "", 0),
    ]);
    return { ok: true };
  });
  app.post("/auth/logout", async (request, reply) => {
    await auth.logout(readCookie(request.headers.cookie, sessionName));
    void reply.header("Set-Cookie", cookie(sessionName, "", 0));
    return { ok: true };
  });
  app.register((secured, _options, done) => {
    secured.addHook("preHandler", async (request) => {
      if (
        !(await auth.identity(readCookie(request.headers.cookie, sessionName)))
      )
        throw new HttpError(
          401,
          "Sign in with an approved administrator address",
        );
    });
    secured.get("/api/session", async (request) => ({
      email: await auth.identity(
        readCookie(request.headers.cookie, sessionName),
      ),
    }));
    secured.get("/api/recipients", async (request) => {
      const query = z
        .object({ after: z.uuid().optional() })
        .strict()
        .parse(request.query);
      return { items: await store.list(query.after) };
    });
    secured.get("/api/history/:id", async (request) => {
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      return { items: await store.history(id) };
    });
    secured.post("/api/recipients", async (request) => {
      const actor = await auth.identity(
        readCookie(request.headers.cookie, sessionName),
      );
      if (!actor) throw new HttpError(401, "Session expired");
      const body = z.record(z.string(), z.unknown()).parse(request.body);
      const change = recipientChangeSchema.parse({ ...body, actor });
      try {
        return { item: await store.change(change) };
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Recipient changed; reload before editing"
        )
          throw new HttpError(
            409,
            "Settings changed. Reload the list before editing again.",
          );
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          ["P2002", "P2025"].includes(String(error.code))
        )
          throw new HttpError(
            409,
            "Address already exists or recipient was removed. Reload the list.",
          );
        throw error;
      }
    });
    done();
  });
  return app;
}

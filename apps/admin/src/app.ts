import Fastify from "fastify";
import { z, ZodError } from "zod";
import {
  recipientChangeSchema,
  contentApprovalSchema,
  ContentApprovalConflict,
  competitionChangeSchema,
  CompetitionConflict,
  apiClientChangeSchema,
  ApiClientConflict,
  matchControlSchema,
  MatchControlConflict,
  preMatchToggleSchema,
  PreMatchQuotaExceededError,
} from "@fcp/database";
import { adminAuth, secret, sendLogin, type AuthRedis } from "./auth.js";
import type { AdminConfig } from "./config.js";
import { liveFeedQuery } from "./live-feed.js";
import { page, operationsStylesheet, browserScript } from "./ui.js";

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
  dashboard?: () => Promise<unknown>;
  liveFeed?: (after?: string) => Promise<unknown>;
  matchEmails?: () => Promise<unknown>;
  competitions?: {
    list(after?: string): Promise<unknown>;
    change(input: unknown, actor: string): Promise<unknown>;
    history(): Promise<unknown>;
  };
  apiClients?: {
    list(): Promise<unknown>;
    create(input: unknown): Promise<unknown>;
    revoke(id: string): Promise<unknown>;
  };
  matches?: {
    list(date: string): Promise<unknown>;
    change(input: unknown, actor: string): Promise<unknown>;
  };
  preMatch?: {
    list(date: string): Promise<unknown>;
    toggle(input: unknown, actor: string): Promise<unknown>;
  };
  content?: {
    list(after?: string): Promise<unknown>;
    approve(input: unknown, actor: string): Promise<unknown>;
    history(): Promise<unknown>;
  };
  send?: (email: string, token: string) => Promise<void>;
  acquireRedis?: () => { ready: Promise<void>; release: () => void };
}) {
  const { config, redis, store } = deps;
  const auth = adminAuth(redis, config);
  // No automatic request logs: even malicious query strings must not leak credentials.
  const app = Fastify({ logger: false, trustProxy: false, bodyLimit: 16384 });
  const leases = new WeakMap<object, () => void>();
  app.addHook("onResponse", (request, _reply, done) => {
    leases.get(request)?.();
    leases.delete(request);
    done();
  });
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
  const requireRole = async (request: { headers: { cookie?: string | undefined } }, minimum: "editor" | "admin") => {
    const email = await auth.identity(readCookie(request.headers.cookie, sessionName));
    if (!email) throw new HttpError(401, "Session expired; sign in again");
    const role = await auth.role(email);
    if (role !== "admin" && !(minimum === "editor" && role === "editor"))
      throw new HttpError(403, "Your account does not have permission for this action");
    return email;
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
        !config.allowedOrigins.has(request.headers.origin ?? "") ||
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
      if (deps.acquireRedis) {
        const lease = deps.acquireRedis();
        leases.set(request, lease.release);
        await lease.ready;
      }
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
    reply.type("text/css").send(operationsStylesheet),
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
  app.post("/auth/password", async (request, reply) => {
    const { email, password } = z.object({
      email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
      password: z.string().min(1).max(128),
    }).strict().parse(request.body);
    if (!(await auth.limit("login-ip", request.ip, 10, 600)))
      throw new HttpError(429, "Too many sign-in attempts; try again later");
    const permitted = await auth.limit("login-password-email", email, 8, 600);
    const global = await auth.limit("login-global", "all", 60, 600);
    const session = permitted && global ? await auth.login(email, password) : null;
    if (!session) throw new HttpError(401, "Email or password is incorrect");
    void reply.header("Set-Cookie", cookie(sessionName, session, 28800));
    return { ok: true };
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
    secured.get("/api/session", async (request) => {
      const email = await auth.identity(readCookie(request.headers.cookie, sessionName));
      return { email, role: email ? await auth.role(email) : null };
    });
    secured.get("/api/users", async (request) => {
      await requireRole(request, "admin");
      const users = await auth.users();
      return {
        users: users.map((user) => ({ ...user, configured: config.admins.has(user.email) })),
        configuredAdmins: [...config.admins].filter((email) => !users.some((user) => user.email === email)),
      };
    });
    secured.post("/api/users", async (request) => {
      const actor = await requireRole(request, "admin");
      const input = z.discriminatedUnion("action", [
        z.object({ action: z.literal("create"), email: z.string().trim().toLowerCase().max(254).pipe(z.email()), role: z.enum(["viewer", "editor", "admin"]), password: z.string().min(12).max(128) }).strict(),
        z.object({ action: z.literal("update"), email: z.string().trim().toLowerCase().max(254).pipe(z.email()), role: z.enum(["viewer", "editor", "admin"]), disabled: z.boolean(), password: z.string().min(12).max(128).optional() }).strict(),
      ]).parse(request.body);
      if (input.action === "create") {
        if ((await auth.users()).some((user) => user.email === input.email) || (config.admins.has(input.email) && input.role !== "admin"))
          throw new HttpError(409, "An account with this email already exists");
        return { user: await auth.saveUser(input) };
      }
      if (input.email === actor && (input.disabled || input.role !== "admin"))
        throw new HttpError(400, "You cannot disable or downgrade your own account");
      if (config.admins.has(input.email) && (input.role !== "admin" || input.disabled))
        throw new HttpError(400, "Original administrators must remain enabled as admins; you may reset their password");
      const user = await auth.updateUser({
        email: input.email,
        role: input.role,
        disabled: input.disabled,
        ...(input.password === undefined ? {} : { password: input.password }),
      });
      if (!user) throw new HttpError(404, "Account not found");
      return { user };
    });
    secured.get("/api/live-feed", async (request) => {
      if (!deps.liveFeed)
        throw new HttpError(503, "Live feed is not configured");
      const { after } = liveFeedQuery.parse(request.query);
      return deps.liveFeed(after);
    });
    secured.get("/api/matches", async (request) => {
      if (!deps.matches)
        throw new HttpError(503, "Match controls are not configured");
      const { date } = z
        .object({ date: z.iso.date() })
        .strict()
        .parse(request.query);
      return deps.matches.list(date);
    });
    secured.get("/api/pre-match", async (request) => {
      if (!deps.preMatch)
        throw new HttpError(503, "Pre-match controls are not configured");
      const { date } = z
        .object({ date: z.iso.date() })
        .strict()
        .parse(request.query);
      return deps.preMatch.list(date);
    });
    secured.post("/api/pre-match", async (request) => {
      if (!deps.preMatch)
        throw new HttpError(503, "Pre-match controls are not configured");
      const actor = await requireRole(request, "editor");
      try {
        return {
          item: await deps.preMatch.toggle(
            preMatchToggleSchema.parse(request.body),
            actor,
          ),
        };
      } catch (error) {
        if (error instanceof PreMatchQuotaExceededError)
          throw new HttpError(409, error.message);
        throw error;
      }
    });
    secured.post("/api/matches", async (request) => {
      if (!deps.matches)
        throw new HttpError(503, "Match controls are not configured");
      const actor = await requireRole(request, "editor");
      try {
        return {
          item: await deps.matches.change(
            matchControlSchema.parse(request.body),
            actor,
          ),
        };
      } catch (error) {
        if (error instanceof MatchControlConflict)
          throw new HttpError(409, error.message);
        throw error;
      }
    });
    secured.get("/api/content/drafts", async (request) => {
      if (!deps.content)
        throw new HttpError(503, "Content approval is not configured");
      const { after } = z
        .object({ after: z.uuid().optional() })
        .strict()
        .parse(request.query);
      return { items: await deps.content.list(after) };
    });
    secured.get("/api/competitions", async (request) => {
      if (!deps.competitions)
        throw new HttpError(503, "League controls are not configured");
      const { after } = z
        .object({ after: z.uuid().optional() })
        .strict()
        .parse(request.query);
      return { items: await deps.competitions.list(after) };
    });
    secured.get("/api/competitions/history", async () => {
      if (!deps.competitions)
        throw new HttpError(503, "League controls are not configured");
      return { items: await deps.competitions.history() };
    });
    secured.get("/api/clients", async (request) => {
      await requireRole(request, "admin");
      if (!deps.apiClients)
        throw new HttpError(503, "API access is not configured");
      return { items: await deps.apiClients.list() };
    });
    secured.post("/api/clients", async (request) => {
      if (!deps.apiClients)
        throw new HttpError(503, "API access is not configured");
      const actor = await requireRole(request, "admin");
      const change = apiClientChangeSchema.parse(request.body);
      try {
        if (change.action === "create") {
          if (!(await auth.limit("api-key-create", actor, 5, 3600)))
            throw new HttpError(429, "Key creation limit reached. Try later.");
          return await deps.apiClients.create(change);
        }
        return { client: await deps.apiClients.revoke(change.id) };
      } catch (error) {
        if (error instanceof ApiClientConflict)
          throw new HttpError(409, error.message);
        throw error;
      }
    });
    secured.post("/api/competitions", async (request) => {
      if (!deps.competitions)
        throw new HttpError(503, "League controls are not configured");
      const actor = await requireRole(request, "editor");
      const input = competitionChangeSchema.parse(request.body);
      try {
        return { item: await deps.competitions.change(input, actor) };
      } catch (error) {
        if (error instanceof CompetitionConflict)
          throw new HttpError(409, error.message);
        throw error;
      }
    });
    secured.get("/api/content/history", async () => {
      if (!deps.content)
        throw new HttpError(503, "Content approval is not configured");
      return { items: await deps.content.history() };
    });
    secured.post("/api/content/approve", async (request) => {
      if (!deps.content)
        throw new HttpError(503, "Content approval is not configured");
      const actor = await requireRole(request, "editor");
      const input = contentApprovalSchema.parse(request.body);
      try {
        return { item: await deps.content.approve(input, actor) };
      } catch (error) {
        if (error instanceof ContentApprovalConflict)
          throw new HttpError(409, error.message);
        throw error;
      }
    });
    secured.get("/api/recipients", async (request) => {
      await requireRole(request, "admin");
      const query = z
        .object({ after: z.uuid().optional() })
        .strict()
        .parse(request.query);
      return { items: await store.list(query.after) };
    });
    secured.get("/api/match-emails", async (request) => {
      await requireRole(request, "admin");
      if (!deps.matchEmails)
        throw new HttpError(503, "Match email status is not configured");
      return { items: await deps.matchEmails() };
    });
    secured.get("/api/dashboard", async () => {
      if (!deps.dashboard)
        throw new HttpError(503, "Dashboard is not configured");
      return deps.dashboard();
    });
    secured.get("/api/history/:id", async (request) => {
      await requireRole(request, "admin");
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      return { items: await store.history(id) };
    });
    secured.post("/api/recipients", async (request) => {
      const actor = await requireRole(request, "admin");
      const body = z.record(z.string(), z.unknown()).parse(request.body);
      const change = recipientChangeSchema.parse({ ...body, actor });
      if (
        change.action !== "remove" &&
        !config.admins.has(change.settings.email)
      )
        throw new HttpError(
          403,
          "Alert addresses must be approved administrators",
        );
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

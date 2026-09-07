import { consumeScript, type AuthRedis } from "../../apps/admin/src/auth.js";
import { adminConfig } from "../../apps/admin/src/config.js";
export const testAdminConfig = (origin = "https://admin.example.com") =>
  adminConfig({
    NODE_ENV: "test",
    ADMIN_ORIGIN: origin,
    ADMIN_NAMESPACE: "test_admin",
    ADMIN_EMAILS: "admin@example.com",
    RESEND_FROM: "login@example.com",
    RESEND_API_KEY: "test-key-not-real",
  });
/** Test double only; real atomic/expiry behavior is covered in isolated Redis tests. */
export function memoryAuthRedis(): AuthRedis {
  const values = new Map<string, { value: string; expires: number }>();
  const read = (key: string) => {
    const value = values.get(key);
    if (!value || value.expires <= Date.now()) {
      values.delete(key);
      return null;
    }
    return value.value;
  };
  return {
    get: (key) => Promise.resolve(read(key)),
    set: (key, value, _mode, ttl) => {
      values.set(key, { value, expires: Date.now() + ttl * 1000 });
      return Promise.resolve("OK");
    },
    del: (key) => Promise.resolve(Number(values.delete(key))),
    eval: (script, _count, ...args) => {
      const key = String(args[0]);
      const value = read(key);
      if (script === consumeScript) {
        if (!value) return Promise.resolve(null);
        const data = JSON.parse(value) as { email: string; browser: string };
        if (data.browser !== args[1]) return Promise.resolve(null);
        values.delete(key);
        return Promise.resolve(data.email);
      }
      const n = Number(value ?? 0) + 1;
      values.set(key, {
        value: String(n),
        expires:
          values.get(key)?.expires ?? Date.now() + Number(args[1]) * 1000,
      });
      return Promise.resolve(n);
    },
  };
}

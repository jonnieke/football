import Fastify from "fastify";
import { describe, expect, it } from "vitest";

describe("patched Fastify security contracts", () => {
  it("ignores forwarded host/protocol from an untrusted peer", async () => {
    const app = Fastify({ trustProxy: "127.0.0.1" });
    app.get("/probe", (request) => ({
      host: request.host,
      protocol: request.protocol,
      ip: request.ip,
    }));
    try {
      const response = await app.inject({
        url: "/probe",
        remoteAddress: "192.0.2.10",
        headers: {
          host: "expected.example",
          "x-forwarded-host": "spoof.example",
          "x-forwarded-proto": "https",
          "x-forwarded-for": "198.51.100.10",
        },
      });
      expect(response.json()).toEqual({
        host: "expected.example",
        protocol: "http",
        ip: "192.0.2.10",
      });
    } finally {
      await app.close();
    }
  });
  it.each(["application/json\ta", " application/json"])(
    "does not bypass body validation with %j",
    async (contentType) => {
      const app = Fastify();
      app.post(
        "/probe",
        {
          schema: {
            body: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["requiredField"],
                    properties: { requiredField: { type: "string" } },
                  },
                },
              },
            },
          },
        },
        () => ({ accepted: true }),
      );
      try {
        const response = await app.inject({
          method: "POST",
          url: "/probe",
          headers: { "content-type": contentType },
          payload: "{}",
        });
        expect(response.statusCode).toBeGreaterThanOrEqual(400);
        expect(response.statusCode).toBeLessThan(500);
      } finally {
        await app.close();
      }
    },
  );
});

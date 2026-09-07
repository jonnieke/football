import pino, { type Logger } from "pino";

const redact = [
  "req.headers.authorization",
  "headers.authorization",
  "authorization",
  "apiKey",
  "api_key",
  "keyHash",
  "key_hash",
  "*.authorization",
  "*.apiKey",
];

export function createLogger(level = "info"): Logger {
  return pino({
    level,
    redact: { paths: redact, censor: "[REDACTED]" },
    base: null,
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

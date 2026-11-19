import pino from "pino";
import { redact, redactDeep } from "./redact";

/** Structured JSON logs. Every string is passed through redact() before it is written. */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  hooks: {
    logMethod(args, method) {
      method.apply(this, args.map((a) => (typeof a === "string" ? redact(a) : a)) as Parameters<typeof method>);
    },
  },
  formatters: {
    log(obj) {
      return redactDeep(obj);
    },
  },
});

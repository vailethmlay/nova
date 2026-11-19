import { describe, expect, it } from "vitest";
import { redact, redactDeep } from "@/lib/redact";

describe("redact", () => {
  it.each([
    ["ghp_0123456789abcdefghijABCDEFGHIJ", "[REDACTED_GITHUB_TOKEN]"],
    ["github_pat_11ABCDEFG0123456789_abcdefghijklmnop", "[REDACTED_GITHUB_TOKEN]"],
    ["sk-ant-api03-abcdefghijklmnop", "[REDACTED_ANTHROPIC_KEY]"],
    ["AKIAABCDEFGHIJKLMNOP", "[REDACTED_AWS_KEY]"],
    ["postgres://nova:hunter2@db:5432/nova", "postgres://[REDACTED]@db:5432/nova"],
    ["DB_PASSWORD=hunter2hunter2", "DB_PASSWORD=[REDACTED]"],
    ["-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----", "[REDACTED_PRIVATE_KEY]"],
  ])("redacts %s", (input, expected) => {
    expect(redact(input)).toBe(expected);
  });

  it("leaves ordinary text alone", () => {
    expect(redact("PR #42 changes the login page")).toBe("PR #42 changes the login page");
  });

  it("keeps structure when redacting deeply", () => {
    expect(redactDeep({ a: ["API_TOKEN: abcdef123"], n: 3 })).toEqual({ a: ["API_TOKEN=[REDACTED]"], n: 3 });
  });
});

import { describe, expect, it } from "vitest";

import { stableStringify } from "./canonical";
import { hashAddress, requestHash, sha256Hex } from "./hash";
import { isUuid, newId, traceIdFromHeader, userIdFromExternalId } from "./ids";

describe("identifiers", () => {
  it("generates UUIDv7 values", () => {
    const id = newId();

    expect(id[14]).toBe("7");
    expect(isUuid(id)).toBe(true);
  });

  it("derives stable user IDs from external IDs", () => {
    const first = userIdFromExternalId("cust_1042");
    const second = userIdFromExternalId("cust_1042");

    expect(first).toBe(second);
    expect(first).not.toBe(userIdFromExternalId("cust_1043"));
  });

  it("uses a valid trace header or generates one", () => {
    const trace = "0199f3f2-7d4a-7c3e-9b1a-2f6e5d4c3b2a";

    expect(traceIdFromHeader(trace)).toBe(trace);
    expect(traceIdFromHeader("not-a-uuid")).not.toBe("not-a-uuid");
  });
});

describe("hashing", () => {
  it("hashes canonically regardless of key order", () => {
    expect(requestHash({ a: 1, b: { c: 2, d: 3 } })).toBe(
      requestHash({ b: { d: 3, c: 2 }, a: 1 }),
    );
  });

  it("normalizes stable JSON", () => {
    expect(stableStringify({ b: 1, a: undefined })).toBe('{"a":null,"b":1}');
    expect(sha256Hex("herald")).toHaveLength(64);
  });

  it("peppers addresses consistently", () => {
    expect(hashAddress("User@Example.test", "pepper")).toBe(
      hashAddress(" user@example.test ", "pepper"),
    );
    expect(hashAddress("user@example.test", "pepper")).not.toBe(
      hashAddress("user@example.test", "other"),
    );
  });
});

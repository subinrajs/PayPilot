import { describe, expect, it } from "vitest";
import { AuthorizationError, assertOwnedByCustomer, scopeListParams } from "./authorization.js";

describe("authorization", () => {
  it("passes when the resource's customer id (string form) matches", () => {
    expect(() => assertOwnedByCustomer("cus_123", { customer: "cus_123" })).not.toThrow();
  });

  it("passes when the resource's customer is an expanded object with a matching id", () => {
    expect(() =>
      assertOwnedByCustomer("cus_123", { customer: { id: "cus_123" } as never }),
    ).not.toThrow();
  });

  it("throws when the resource belongs to a different customer", () => {
    expect(() => assertOwnedByCustomer("cus_123", { customer: "cus_456" })).toThrow(AuthorizationError);
  });

  it("throws when the resource has no customer at all", () => {
    expect(() => assertOwnedByCustomer("cus_123", { customer: null })).toThrow(AuthorizationError);
  });

  it("builds a customer-scoped list filter", () => {
    expect(scopeListParams("cus_123")).toEqual({ customer: "cus_123" });
  });
});

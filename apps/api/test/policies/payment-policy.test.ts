import { describe, expect, it } from "vitest";
import { PAYMENT_CAP_CENTS, PaymentCapExceededError, assertBelowCap, isAtOrAboveCap } from "../../src/policies/payment-policy.js";

describe("payment-policy", () => {
  it("is under the cap just below the boundary", () => {
    expect(isAtOrAboveCap(PAYMENT_CAP_CENTS - 1)).toBe(false);
    expect(() => assertBelowCap(PAYMENT_CAP_CENTS - 1)).not.toThrow();
  });

  it("is at or above the cap exactly at the boundary", () => {
    expect(isAtOrAboveCap(PAYMENT_CAP_CENTS)).toBe(true);
    expect(() => assertBelowCap(PAYMENT_CAP_CENTS)).toThrow(PaymentCapExceededError);
  });

  it("is at or above the cap just above the boundary", () => {
    expect(isAtOrAboveCap(PAYMENT_CAP_CENTS + 1)).toBe(true);
    expect(() => assertBelowCap(PAYMENT_CAP_CENTS + 1)).toThrow(PaymentCapExceededError);
  });
});

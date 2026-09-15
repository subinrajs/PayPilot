import { describe, expect, it } from "vitest";
import { getCustomerId, linkChat } from "./session.js";

describe("session", () => {
  it("links a new chat to a customer", () => {
    expect(linkChat(101, "cus_a")).toBe("linked");
    expect(getCustomerId(101)).toBe("cus_a");
  });

  it("treats a re-send of the same chat+customer pair as an idempotent no-op", () => {
    expect(linkChat(102, "cus_b")).toBe("linked");
    expect(linkChat(102, "cus_b")).toBe("linked");
    expect(getCustomerId(102)).toBe("cus_b");
  });

  it("rejects linking a customer that's already linked to a different chat", () => {
    expect(linkChat(103, "cus_c")).toBe("linked");
    expect(linkChat(104, "cus_c")).toBe("already_linked_elsewhere");
    expect(getCustomerId(104)).toBeUndefined();
  });

  it("rejects re-linking a chat that's already linked to a different customer", () => {
    expect(linkChat(105, "cus_d")).toBe("linked");
    expect(linkChat(105, "cus_e")).toBe("chat_linked_to_other_customer");
    expect(getCustomerId(105)).toBe("cus_d");
  });

  it("returns undefined for an unlinked chat", () => {
    expect(getCustomerId(999)).toBeUndefined();
  });
});

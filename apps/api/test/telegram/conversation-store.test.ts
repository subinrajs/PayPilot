import { describe, expect, it } from "vitest";
import {
  clearConversationHistory,
  getConversationHistory,
  setConversationHistory,
} from "../../src/telegram/conversation-store.js";

describe("conversation-store", () => {
  it("returns an empty history for a chat that's never been stored", () => {
    expect(getConversationHistory(9001)).toEqual([]);
  });

  it("returns what was stored for that chat", () => {
    setConversationHistory(9002, [{ role: "user", content: "hello" }]);
    expect(getConversationHistory(9002)).toEqual([{ role: "user", content: "hello" }]);
  });

  it("keeps each chat's history isolated from every other chat", () => {
    setConversationHistory(9003, [{ role: "user", content: "chat A" }]);
    setConversationHistory(9004, [{ role: "user", content: "chat B" }]);

    expect(getConversationHistory(9003)).toEqual([{ role: "user", content: "chat A" }]);
    expect(getConversationHistory(9004)).toEqual([{ role: "user", content: "chat B" }]);
  });

  it("overwrites rather than appends on a second set for the same chat", () => {
    setConversationHistory(9005, [{ role: "user", content: "first" }]);
    setConversationHistory(9005, [{ role: "user", content: "first" }, { role: "assistant", content: "reply" }]);

    expect(getConversationHistory(9005)).toEqual([
      { role: "user", content: "first" },
      { role: "assistant", content: "reply" },
    ]);
  });

  it("clears a chat's history back to empty, leaving other chats untouched", () => {
    setConversationHistory(9006, [{ role: "user", content: "will be cleared" }]);
    setConversationHistory(9007, [{ role: "user", content: "stays" }]);

    clearConversationHistory(9006);

    expect(getConversationHistory(9006)).toEqual([]);
    expect(getConversationHistory(9007)).toEqual([{ role: "user", content: "stays" }]);
  });

  it("clearing an already-empty/unknown chat is a no-op, not an error", () => {
    expect(() => clearConversationHistory(9008)).not.toThrow();
    expect(getConversationHistory(9008)).toEqual([]);
  });
});

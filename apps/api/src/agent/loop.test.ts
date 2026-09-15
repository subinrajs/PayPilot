import { describe, expect, it } from "vitest";
import { runAssistantTurn } from "./loop.js";
import { consumePendingAction } from "./pending-action-store.js";
import { asOpenAI, completionOf, createFakeOpenAI, toolCall } from "../test-support/fake-openai.js";
import { asStripe, asyncIterableList, createFakeStripe, fakeCharge, fakeCustomer } from "../test-support/fake-stripe.js";

describe("runAssistantTurn", () => {
  it("returns the model's reply directly when it makes no tool calls", async () => {
    const stripe = createFakeStripe();
    const openai = createFakeOpenAI();
    openai.chat.completions.create.mockResolvedValueOnce(completionOf({ content: "Hi, how can I help?" }));

    const result = await runAssistantTurn(asStripe(stripe), asOpenAI(openai), [
      { role: "user", content: "hello" },
    ]);

    expect(result.reply).toBe("Hi, how can I help?");
    expect(result.pendingAction).toBeUndefined();
    // The injected system message must not leak into what's handed back to the client.
    expect(result.messages.some((m) => m.role === "system")).toBe(false);
  });

  it("runs a read-only tool call and feeds the result back for narration", async () => {
    const stripe = createFakeStripe();
    stripe.charges.list.mockReturnValueOnce(asyncIterableList([fakeCharge({ amount: 8000, status: "succeeded" })]));

    const openai = createFakeOpenAI();
    const call = toolCall("get_daily_summary", { date: "2026-09-14" });
    openai.chat.completions.create
      .mockResolvedValueOnce(completionOf({ tool_calls: [call] }))
      .mockResolvedValueOnce(completionOf({ content: "You made $80 today." }));

    const result = await runAssistantTurn(asStripe(stripe), asOpenAI(openai), [
      { role: "user", content: "summarize my day" },
    ]);

    expect(result.reply).toBe("You made $80 today.");
    expect(result.pendingAction).toBeUndefined();

    const toolResultMessage = result.messages.find((m) => m.role === "tool");
    expect(toolResultMessage).toBeDefined();
    expect(JSON.parse((toolResultMessage as { content: string }).content)).toMatchObject({ succeededTotalCents: 8000 });
  });

  it("stores and returns a pending action when a money-moving tool proposes one", async () => {
    const stripe = createFakeStripe();
    stripe.customers.list.mockReturnValueOnce(asyncIterableList([fakeCustomer({ id: "cus_maya", name: "Maya Rodriguez" })]));
    stripe.charges.list.mockResolvedValueOnce({ data: [fakeCharge({ id: "ch_1", customer: "cus_maya", amount: 8000 })] });

    const openai = createFakeOpenAI();
    const call = toolCall("propose_refund", { customerReference: "Maya", paymentReference: "last" });
    openai.chat.completions.create
      .mockResolvedValueOnce(completionOf({ tool_calls: [call] }))
      .mockResolvedValueOnce(completionOf({ content: "I'll refund Maya Rodriguez $80.00 — confirm?" }));

    const result = await runAssistantTurn(asStripe(stripe), asOpenAI(openai), [
      { role: "user", content: "refund Maya's last payment" },
    ]);

    expect(result.pendingAction).toBeDefined();
    expect(result.pendingAction?.tool).toBe("refund");

    // Actually stored server-side, not just returned in the response.
    const stored = consumePendingAction(result.pendingAction!.id);
    expect(stored).toEqual(result.pendingAction);
  });

  it("feeds an unknown tool name back as an error instead of throwing", async () => {
    const stripe = createFakeStripe();
    const openai = createFakeOpenAI();
    const call = toolCall("delete_all_customers", {});
    openai.chat.completions.create
      .mockResolvedValueOnce(completionOf({ tool_calls: [call] }))
      .mockResolvedValueOnce(completionOf({ content: "I can't do that." }));

    const result = await runAssistantTurn(asStripe(stripe), asOpenAI(openai), [{ role: "user", content: "hi" }]);

    expect(result.reply).toBe("I can't do that.");
    const toolResultMessage = result.messages.find((m) => m.role === "tool");
    expect(JSON.parse((toolResultMessage as { content: string }).content)).toMatchObject({
      error: expect.stringContaining("Unknown tool"),
    });
  });

  it("feeds a tool argument validation error back as the tool result rather than throwing", async () => {
    const stripe = createFakeStripe();
    const openai = createFakeOpenAI();
    const call = toolCall("get_daily_summary", { date: "not-a-date" });
    openai.chat.completions.create
      .mockResolvedValueOnce(completionOf({ tool_calls: [call] }))
      .mockResolvedValueOnce(completionOf({ content: "Let me try again." }));

    const result = await runAssistantTurn(asStripe(stripe), asOpenAI(openai), [
      { role: "user", content: "summarize today" },
    ]);

    const toolResultMessage = result.messages.find((m) => m.role === "tool");
    const parsed = JSON.parse((toolResultMessage as { content: string }).content);
    expect(parsed.error).toBeDefined();
  });

  it("throws if the model never stops calling tools", async () => {
    const stripe = createFakeStripe();
    stripe.charges.list.mockReturnValue(asyncIterableList([]));

    const openai = createFakeOpenAI();
    openai.chat.completions.create.mockResolvedValue(
      completionOf({ tool_calls: [toolCall("get_daily_summary", { date: "2026-09-14" })] }),
    );

    await expect(
      runAssistantTurn(asStripe(stripe), asOpenAI(openai), [{ role: "user", content: "loop forever" }]),
    ).rejects.toThrow(/maximum number of tool-call rounds/);
  });

  it("still surfaces a pending action produced on the final round instead of discarding it", async () => {
    const stripe = createFakeStripe();
    stripe.customers.list.mockReturnValue(asyncIterableList([fakeCustomer({ id: "cus_maya", name: "Maya Rodriguez" })]));
    stripe.charges.list.mockResolvedValue({ data: [fakeCharge({ id: "ch_1", customer: "cus_maya", amount: 8000 })] });

    const openai = createFakeOpenAI();
    // The model keeps calling propose_refund every round (never stops on its own), so the loop
    // hits MAX_TOOL_ROUNDS — but a pending action was created on the very first round and must
    // still come back to the caller rather than being silently stranded in the store.
    openai.chat.completions.create.mockResolvedValue(
      completionOf({ tool_calls: [toolCall("propose_refund", { customerReference: "Maya", paymentReference: "last" })] }),
    );

    const result = await runAssistantTurn(asStripe(stripe), asOpenAI(openai), [
      { role: "user", content: "refund Maya's last payment" },
    ]);

    expect(result.pendingAction).toBeDefined();
    expect(result.pendingAction?.tool).toBe("refund");
    expect(consumePendingAction(result.pendingAction!.id)).not.toBeNull();
  });
});

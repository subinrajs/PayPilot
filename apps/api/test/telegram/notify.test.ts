import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMessage = vi.fn();
vi.mock("grammy", () => ({
  Api: vi.fn().mockImplementation(() => ({ sendMessage })),
}));

import { Api } from "grammy";
import { sendTelegramMessage } from "../../src/telegram/notify.js";

describe("sendTelegramMessage", () => {
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
  });

  afterEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = originalToken;
  });

  it("sends the given text to the given chat via a fresh Api client built from TELEGRAM_BOT_TOKEN", async () => {
    await sendTelegramMessage(555, "Payment received");

    expect(Api).toHaveBeenCalledWith("test-token");
    expect(sendMessage).toHaveBeenCalledWith(555, "Payment received");
  });

  it("throws rather than silently no-op-ing when TELEGRAM_BOT_TOKEN is unset", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;

    await expect(sendTelegramMessage(555, "hi")).rejects.toThrow(/TELEGRAM_BOT_TOKEN/);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

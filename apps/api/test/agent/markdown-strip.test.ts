import { describe, expect, it } from "vitest";
import { stripMarkdownArtifacts } from "../../src/agent/markdown-strip.js";

describe("stripMarkdownArtifacts", () => {
  it("leaves plain text with no Markdown untouched", () => {
    const text = "Here's what Acme Corp owes: two open invoices totaling $700.00.";
    expect(stripMarkdownArtifacts(text)).toBe(text);
  });

  it("drops **bold** markers, keeping the inner text", () => {
    expect(stripMarkdownArtifacts("**Invoice for services rendered**")).toBe("Invoice for services rendered");
  });

  it("drops __bold__ markers too", () => {
    expect(stripMarkdownArtifacts("__Invoice__")).toBe("Invoice");
  });

  it("collapses a [label](url) link down to just the label, dropping the raw URL", () => {
    const input = "[View Invoice](https://invoice.stripe.com/i/acct_123/test_abc?s=ap)";
    expect(stripMarkdownArtifacts(input)).toBe("View Invoice");
  });

  it("strips a leading heading marker but keeps the heading text", () => {
    expect(stripMarkdownArtifacts("## Invoices due this week")).toBe("Invoices due this week");
  });

  it("handles the exact reported case: bold labels, a numbered list, and a link together", () => {
    const input =
      "1. **Invoice for services rendered**\n" +
      "   Amount Due: $100.00\n" +
      "   [View Invoice](https://invoice.stripe.com/i/acct_1UFjSpIaARQPQcXl/test_abc?s=ap)";

    const result = stripMarkdownArtifacts(input);

    expect(result).not.toContain("**");
    expect(result).not.toContain("https://");
    expect(result).toContain("Invoice for services rendered");
    expect(result).toContain("View Invoice");
  });
});

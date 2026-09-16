// A code-level backstop, not a replacement, for system-prompt.ts's "never Markdown syntax"
// instruction — a system prompt is a request the model can and does ignore (observed in
// practice: a list-shaped result like multiple invoices reliably biases it toward Markdown list
// formatting despite being told not to). This chat UI only ever renders plain text, so any
// Markdown that slips through shows up as literal stray characters to the owner. Applied once,
// server-side, to every final reply — see loop.ts — so no client needs its own copy of this
// logic and no historical message re-sent by the client can still carry unstripped Markdown.
export function stripMarkdownArtifacts(text: string): string {
  return text
    // [label](https://...) -> label. Drops the raw URL entirely rather than reformatting it —
    // where a link exists (e.g. an invoice's hosted_invoice_url), the UI's own structured card
    // already renders a real, clickable link; a bare URL left in prose is dead weight either way.
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|mailto:)\S+?\)/g, "$1")
    // **bold**/__bold__ -> the inner text, markers dropped.
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    // A leading heading marker ("# ", "## ", ...) at the start of a line -> dropped, text kept.
    .replace(/^#{1,6}\s+/gm, "");
}

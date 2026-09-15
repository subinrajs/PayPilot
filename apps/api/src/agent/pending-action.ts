import { randomUUID } from "node:crypto";

// A money-moving tool's `propose*` step returns one of these instead of executing — the caller
// (Phase 4's confirm route, or the Telegram bot directly) must present it for explicit
// confirmation and re-validate before ever calling the matching `execute*`. Checking `expiresAt`
// against wall-clock time only makes sense once there's a second request to check it against, so
// that enforcement lives with whatever holds the pending action, not here.
export interface PendingAction<Tool extends string = string, Args = unknown> {
  id: string;
  tool: Tool;
  arguments: Args;
  expiresAt: number;
}

export const PENDING_ACTION_TTL_MS = 5 * 60 * 1000;

export function createPendingAction<Tool extends string, Args>(
  tool: Tool,
  args: Args,
): PendingAction<Tool, Args> {
  return {
    id: randomUUID(),
    tool,
    arguments: args,
    expiresAt: Date.now() + PENDING_ACTION_TTL_MS,
  };
}

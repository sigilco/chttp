// Progress + log notification shaping.
//
// ToolContext.progress(n, total) emits notifications/progress; the
// progressToken echoes params._meta.progressToken from the tools/call when
// the client sent one (MCP convention). ToolContext.log emits
// notifications/message, filtered by the level set via logging/setLevel.

import { notification } from "./jsonrpc.ts";
import type { JsonRpcRequest, LogLevel, RequestId } from "./types.ts";

export function progressNotification(
  progressToken: RequestId | null,
  progress: number,
  total: number | null,
  message: string | null,
): JsonRpcRequest {
  // Open record: expanding writes on a non-empty literal are dropped when
  // scriptc lowers the packed dist JS, so params starts from {}.
  const params: { [k: string]: unknown } = {};
  params["progress"] = progress;
  if (progressToken !== null) {
    params["progressToken"] = progressToken;
  }
  if (total !== null) {
    params["total"] = total;
  }
  if (message !== null) {
    params["message"] = message;
  }
  return notification("notifications/progress", params);
}

export function logNotification(level: LogLevel, data: unknown): JsonRpcRequest {
  const params: { [k: string]: unknown } = { level: level, data: data };
  return notification("notifications/message", params);
}

const LEVELS = ["debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"];

// RFC 5424 severity order; unknown levels compare as "info".
export function levelIndex(level: string): number {
  for (let i = 0; i < LEVELS.length; i++) {
    if (LEVELS[i] === level) {
      return i;
    }
  }
  return 1;
}

export function isLogLevel(level: string): boolean {
  for (let i = 0; i < LEVELS.length; i++) {
    if (LEVELS[i] === level) {
      return true;
    }
  }
  return false;
}

export const LOG_LEVELS: string[] = LEVELS;

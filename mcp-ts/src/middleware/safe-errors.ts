// Never hand an internal error message to the caller.
//
// When a tool handler throws, the MCP SDK turns the exception into an
// `isError` result whose text is `error.message`. For a Postgres failure that
// is the raw driver text (`timestamp out of range: "1e+300"`, `invalid byte
// sequence for encoding "UTF8": 0x00`; R2 audit idx 21/54), and for a fetch
// failure it can name the internal upstream. This wrapper reports the real
// error to Sentry and stderr and returns a fixed, generic message instead.
//
// Sits inside withRateLimit and OUTSIDE withCallLog/withMetrics, so those
// still see the throw (call log row, error metric) before it is masked here.

import * as Sentry from "@sentry/node";

type Handler<Args, R> = (args: Args, extra?: unknown) => Promise<R>;

export function genericToolErrorText(toolName: string): string {
  return `Error: ${toolName} failed with an internal error. Retry later; if it keeps failing, report it at https://github.com/PeganaHQ/Pegana/issues.`;
}

export function withSafeErrors<Args, R>(
  toolName: string,
  handler: Handler<Args, R>,
): Handler<Args, R> {
  return async (args, extra) => {
    try {
      return await handler(args, extra);
    } catch (e) {
      Sentry.captureException(e, { tags: { mcp_tool: toolName } });
      console.error(`[mcp] tool ${toolName} threw:`, e);
      return {
        content: [{ type: "text" as const, text: genericToolErrorText(toolName) }],
        isError: true,
      } as unknown as R;
    }
  };
}

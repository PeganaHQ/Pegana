// Make `structuredContent` match the published outputSchema exactly.
//
// The SDK server validates structuredContent with zod, which STRIPS unknown
// keys during the parse but then sends the ORIGINAL object. The JSON Schema it
// publishes for the same shape says `additionalProperties: false`, and the
// official SDK client validates with AJV against that JSON Schema. So any key
// a handler passes through but did not declare (the engine's `kind`, a REST
// field api-rs adds later) passes on the server and throws in the client
// (R1 audit idx 1: get_assets, get_asset_state, get_loop_exposure).
//
// This wrapper returns the zod-parsed (stripped) value instead, so what goes
// on the wire is exactly what the schema promises. If the parse fails the
// result is left untouched and the SDK's own output validation reports it,
// which keeps a real contract break loud instead of silently reshaping data.

import { z } from "zod";

type Shape = z.ZodRawShape;

interface ToolResultLike {
  isError?: boolean;
  structuredContent?: unknown;
}

export function withConformedOutput<Args, R>(
  outputShape: Shape | undefined,
  handler: (args: Args, extra?: unknown) => Promise<R>,
): (args: Args, extra?: unknown) => Promise<R> {
  if (!outputShape) return handler;
  const schema = z.object(outputShape);
  return async (args, extra) => {
    const result = await handler(args, extra);
    const r = result as ToolResultLike;
    if (r && !r.isError && r.structuredContent !== undefined) {
      const parsed = schema.safeParse(r.structuredContent);
      if (parsed.success) {
        return { ...(result as object), structuredContent: parsed.data } as R;
      }
    }
    return result;
  };
}

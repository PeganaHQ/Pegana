import { describe, expect, it, vi } from "vitest";
import { installProcessGuards } from "../src/lifecycle";

function fakeProc() {
  const h = new Map<string, (...a: unknown[]) => void>();
  return { proc: { on: (ev: string, fn: (...a: unknown[]) => void) => (h.set(ev, fn), undefined) } as never, h };
}

describe("installProcessGuards", () => {
  it("never exits on unhandledRejection / uncaughtException, logs + captures", () => {
    const { proc, h } = fakeProc();
    const log = vi.fn();
    const capture = vi.fn();
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    installProcessGuards(capture, { proc, log });
    h.get("unhandledRejection")!(new Error("boom"));
    h.get("uncaughtException")!(new Error("bang"));
    expect(exit).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledTimes(2);
    expect(log.mock.calls.flat().join(" ")).toMatch(/boom[\s\S]*bang/);
    exit.mockRestore();
  });

  it("logs a line on every exit path", () => {
    const { proc, h } = fakeProc();
    const log = vi.fn();
    installProcessGuards(() => undefined, { proc, log });
    h.get("beforeExit")!(0);
    h.get("exit")!(0);
    const out = log.mock.calls.flat().join(" ");
    expect(out).toMatch(/beforeExit/);
    expect(out).toMatch(/process exiting code=0/);
  });
});

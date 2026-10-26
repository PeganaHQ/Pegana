import { vi } from "vitest";

type ModuleFactory = () => Record<string, unknown>;

type VitestModuleMockApi = typeof vi & {
  doMock?: (id: string, factory: ModuleFactory) => void;
  doUnmock?: (id: string) => void;
  resetModules?: () => void;
};

function vitestModuleApi(): VitestModuleMockApi | null {
  const api = vi as VitestModuleMockApi;
  if (
    typeof api.doMock === "function" &&
    typeof api.doUnmock === "function" &&
    typeof api.resetModules === "function"
  ) {
    return api;
  }
  return null;
}

export async function mockModuleForRunner(
  id: string,
  factory: ModuleFactory,
): Promise<void> {
  const api = vitestModuleApi();
  if (api) {
    api.doMock!(id, factory);
    api.resetModules!();
    return;
  }

  const { mock } = await import("bun:test");
  mock.module(id, factory);
}

export async function restoreModulesForRunner(
  ...ids: string[]
): Promise<void> {
  const api = vitestModuleApi();
  if (api) {
    for (const id of ids) api.doUnmock!(id);
    api.resetModules!();
    return;
  }

  const { mock } = await import("bun:test");
  mock.restore();
}

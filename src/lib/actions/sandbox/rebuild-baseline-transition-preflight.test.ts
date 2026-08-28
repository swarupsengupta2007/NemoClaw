// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertMcpDestroyNotPending: vi.fn(),
  bail: vi.fn(),
  confirmRebuildIntent: vi.fn(),
  countActiveSessions: vi.fn(),
  getSandbox: vi.fn(),
  prepareTargets: vi.fn(),
}));

vi.mock("../../state/registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/registry")>()),
  getSandbox: mocks.getSandbox,
}));

vi.mock("./mcp-bridge-state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./mcp-bridge-state")>()),
  assertMcpDestroyNotPending: mocks.assertMcpDestroyNotPending,
}));

vi.mock("./rebuild-preflight-confirmation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./rebuild-preflight-confirmation")>()),
  confirmRebuildIntent: mocks.confirmRebuildIntent,
  countActiveSandboxSessionsForRebuild: mocks.countActiveSessions,
  createRebuildCommandContext: vi.fn(() => ({
    bail: mocks.bail,
    log: vi.fn(),
    requestedToolDisclosure: undefined,
    requestedDcodeAutoApprovalMode: undefined,
    requestedObservabilityEnabled: undefined,
    skipConfirm: true,
  })),
}));

vi.mock("./rebuild-preflight-target-phase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./rebuild-preflight-target-phase")>()),
  prepareRebuildTargetPreflights: mocks.prepareTargets,
}));

import { runRebuildPreflightPhase } from "./rebuild-preflight-phase";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rebuild MCP destroy marker preflight (#7794)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSandbox.mockReturnValue({
      name: "alpha",
      agent: "openclaw",
      mcp: {
        bridges: {},
        destroyPreparedAt: "2026-06-27T01:00:00.000Z",
      },
    });
    mocks.assertMcpDestroyNotPending.mockImplementation(() => {
      throw new Error("Sandbox 'alpha' has an incomplete MCP destroy transaction");
    });
  });

  it("prints the safe-abort diagnostic and stops before later rebuild phases", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(runRebuildPreflightPhase("alpha", ["--yes"])).resolves.toBeNull();

    const output = error.mock.calls.flat().join("\n");
    expect(output).toContain("Rebuild preflight failed:");
    expect(output).toContain("a pending MCP destroy transaction blocks rebuild.");
    expect(output).toContain("Resolve the pending MCP state before retrying rebuild.");
    expect(output).toContain("Aborting rebuild");
    expect(output).toContain("sandbox is untouched, no data was lost.");
    expect(mocks.bail).toHaveBeenCalledWith(
      "Sandbox 'alpha' has an incomplete MCP destroy transaction",
    );
    expect(mocks.confirmRebuildIntent).not.toHaveBeenCalled();
    expect(mocks.prepareTargets).not.toHaveBeenCalled();
  });
});

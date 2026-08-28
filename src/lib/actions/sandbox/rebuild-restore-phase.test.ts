// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as policies from "../../policy";
import { printSuccessfulRebuildSummary } from "./rebuild-post-restore-phase";
import { runRebuildRestorePhase } from "./rebuild-restore-phase";
import * as snapshotRestore from "./snapshot/restore-authority";

const policyDocument = `version: 1
network_policies:
  operator_added:
    endpoints:
      - host: operator.example.com
        port: 443
`;

function runRestore(backupManifest: never = null as never) {
  return runRebuildRestorePhase({
    sandboxName: "alpha",
    targetAgentType: "openclaw",
    targetImageIsCustom: false,
    backupManifest,
    policyDocument,
    log: vi.fn(),
  });
}

describe("rebuild live-policy restore", () => {
  beforeEach(() => {
    vi.spyOn(policies, "inspectPolicyMutationBoundary").mockReturnValue({
      gatewayName: "nemoclaw",
    });
    vi.spyOn(policies, "getGatewayPresets").mockReturnValue(["npm"]);
  });

  afterEach(() => vi.restoreAllMocks());

  it("restores the exact bounded live-policy handoff and derives status from OpenShell", () => {
    const setLive = vi.spyOn(policies, "setLivePolicyDocument").mockReturnValue(true);

    const result = runRestore();

    expect(setLive).toHaveBeenCalledWith("alpha", policyDocument, {
      boundary: { gatewayName: "nemoclaw" },
      operation: "restore the captured rebuild policy",
      nonFatal: true,
    });
    expect(result).toMatchObject({
      restoreSucceeded: true,
      restoredPresets: ["npm"],
      finalPresets: ["npm"],
      failedPresets: [],
      policyPresetReconciliationVerified: true,
    });
  });

  it("retains rebuild recovery when OpenShell does not confirm the write", () => {
    vi.spyOn(policies, "setLivePolicyDocument").mockReturnValue(false);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = runRestore();

    expect(result).toMatchObject({
      failedPresets: ["live-policy"],
      finalPresets: [],
      policyPresetReconciliationVerified: false,
    });
    expect(error.mock.calls.flat().join("\n")).toContain("rebuild recovery remains pending");
  });

  it("restores workspace state before restoring the captured policy", () => {
    const restoreWorkspace = vi
      .spyOn(snapshotRestore, "restoreRecreatedSandboxStateWithManagedAuthority")
      .mockReturnValue({
        success: true,
        restoredDirs: ["workspace"],
        failedDirs: [],
        restoredFiles: [],
        failedFiles: [],
      });
    const setLive = vi.spyOn(policies, "setLivePolicyDocument").mockReturnValue(true);
    const manifest = {
      agentType: "openclaw",
      backupPath: "/tmp/rebuild-backup",
    } as never;

    const result = runRestore(manifest);

    expect(restoreWorkspace).toHaveBeenCalled();
    expect(setLive).toHaveBeenCalledAfter(restoreWorkspace);
    expect(result.restoreSucceeded).toBe(true);
  });

  it("keeps the force-skipped backup warning in the success summary", () => {
    const writeLine = vi.fn();
    printSuccessfulRebuildSummary(
      {
        sandboxName: "alpha",
        backupManifest: null,
        backupWasForceSkipped: true,
        staleRecovery: false,
        rebuiltAgentName: "OpenClaw",
        expectedVersion: "2026.6.10",
      },
      writeLine,
    );
    expect(writeLine.mock.calls.flat().join("\n")).toContain(
      "Backup was skipped via --force after a total backup failure",
    );
  });
});

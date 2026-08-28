// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

import { runRebuildRestorePhase } from "./rebuild-restore-phase";
import * as policies from "../../policy";
import * as snapshotRestore from "./snapshot/restore-authority";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rebuild restore target forwarding", () => {
  it("forwards the recreated target identity and explicit custom-image capability", () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const restoreRecreatedSandboxState = vi
      .spyOn(snapshotRestore, "restoreRecreatedSandboxStateWithManagedAuthority")
      .mockReturnValue({
        success: true,
        restoredDirs: [],
        restoredFiles: [],
        failedDirs: [],
        failedFiles: [],
      });
    vi.spyOn(policies, "inspectPolicyMutationBoundary").mockReturnValue({
      gatewayName: "nemoclaw",
    });
    vi.spyOn(policies, "setLivePolicyDocument").mockReturnValue(true);
    vi.spyOn(policies, "getGatewayPresets").mockReturnValue([]);

    runRebuildRestorePhase({
      sandboxName: "alpha",
      targetAgentType: "langchain-deepagents-code",
      targetImageIsCustom: true,
      backupManifest: {
        agentType: "openclaw",
        backupPath: "/tmp/rebuild-backup",
      } as never,
      policyDocument: "version: 1\nnetwork_policies: {}\n",
      log: vi.fn(),
    });

    expect(restoreRecreatedSandboxState).toHaveBeenCalledWith(
      "alpha",
      expect.objectContaining({ backupPath: "/tmp/rebuild-backup" }),
      {
        targetAgentType: "langchain-deepagents-code",
        allowCustomImageWholeStateFileRestore: true,
      },
      { getSandbox: expect.any(Function) },
    );
  });
});

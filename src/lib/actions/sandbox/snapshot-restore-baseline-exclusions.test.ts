// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as f from "./snapshot-restore-test-fixture";

beforeEach(f.resetSnapshotRestoreMocks);
afterEach(f.cleanupSnapshotRestoreMocks);

describe("runSandboxSnapshot restore: baseline exclusions", () => {
  it("creates a clone from the exact live policy and ignores legacy exclusions (#7178)", async () => {
    const exclusion = {
      version: 1 as const,
      agent: "hermes",
      key: "nous_research",
      digest: "a".repeat(64),
      acknowledgedAt: "2026-07-19T00:00:00.000Z",
      appliedAgentVersion: "0.18.0",
    };
    let registeredClone: f.SandboxRecord | null = null;
    let policyContentDuringCreate: string | null = null;
    let policyModeDuringCreate: number | null = null;
    f.registerSandboxMock.mockImplementation(
      (entry) => (registeredClone = entry as f.SandboxRecord),
    );
    f.getSandboxMock.mockImplementation((name) =>
      name === "alpha"
        ? {
            name: "alpha",
            agent: "hermes",
            imageTag: "nemoclaw-alpha:test",
            openshellDriver: "docker",
            provider: "nvidia-nim",
            model: "nvidia/model-a",
            baselineExclusions: [exclusion],
          }
        : registeredClone,
    );
    f.captureOpenshellMock.mockImplementation((args) =>
      f.openshellResponses(args, {
        "sandbox list": { status: 0, output: "alpha Ready\nbeta Ready\n" },
      }),
    );
    f.getLatestBackupMock.mockReturnValue({ ...f.latestBackupFixture });
    f.streamSandboxCreateMock.mockImplementation(async (_command, args) => {
      const policyPath = args[args.indexOf("--policy") + 1];
      policyContentDuringCreate = fs.readFileSync(policyPath, "utf8");
      policyModeDuringCreate = fs.statSync(policyPath).mode & 0o777;
      return { status: 0, output: "", sawProgress: false, forcedReady: false };
    });

    const { runSandboxSnapshot } = await import("./snapshot");
    await runSandboxSnapshot("alpha", { kind: "restore", to: "beta" });

    expect(f.inspectPolicyRecoveryBoundaryMock).toHaveBeenCalledWith(
      "alpha",
      "capture the live policy for snapshot clone",
    );
    expect(policyContentDuringCreate).toBe(f.livePolicyDocument);
    expect(policyModeDuringCreate).toBe(0o600);
    expect(f.registerSandboxMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ baselineExclusions: expect.anything() }),
      undefined,
      { pending: true },
    );
  }, 15_000);
});

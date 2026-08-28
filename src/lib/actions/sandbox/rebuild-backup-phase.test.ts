// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

import * as sandboxState from "../../state/sandbox";
import { runRebuildBackupPhase } from "./rebuild-backup-phase";

afterEach(() => vi.restoreAllMocks());

describe("rebuild live policy backup", () => {
  it("uses the bounded policy handoff for interrupted rebuild recovery", () => {
    const manifest = {
      rebuildPolicyHandoff: { path: "/tmp/policy", sha256: "a" },
    } as never;
    vi.spyOn(sandboxState, "readRebuildPolicyHandoff").mockReturnValue("version: 1\n");

    const result = runRebuildBackupPhase({
      sandboxName: "alpha",
      sandboxEntry: { name: "alpha" },
      staleRecovery: true,
      preparedRecoveryManifest: manifest,
      messagingPlan: null,
      webSearchConfig: null,
      log: vi.fn(),
      bail: (message): never => {
        throw new Error(message);
      },
      relockShieldsIfNeeded: vi.fn(() => true),
    });

    expect(result).toMatchObject({
      backupManifest: manifest,
      policyDocument: "version: 1\n",
    });
  });

  it("fails closed when an interrupted rebuild has no verified handoff", () => {
    vi.spyOn(sandboxState, "readRebuildPolicyHandoff").mockReturnValue(null);
    const bail = vi.fn((message: string): never => {
      throw new Error(message);
    });
    const relock = vi.fn(() => true);

    expect(() =>
      runRebuildBackupPhase({
        sandboxName: "alpha",
        sandboxEntry: { name: "alpha" },
        staleRecovery: true,
        preparedRecoveryManifest: {} as never,
        messagingPlan: null,
        webSearchConfig: null,
        log: vi.fn(),
        bail,
        relockShieldsIfNeeded: relock,
      }),
    ).toThrow("no verified live-policy handoff");
    expect(bail).toHaveBeenCalledWith(expect.stringContaining("no verified live-policy handoff"));
    expect(relock).toHaveBeenCalled();
  });
});

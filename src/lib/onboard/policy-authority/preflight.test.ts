// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";

import { validateLiveSandboxPolicyRequirements } from "./preflight";

describe("live policy preflight", () => {
  it("does not inspect policy before a sandbox exists", () => {
    const prepareRequiredPolicy = vi.fn();
    const inspectSandboxPolicyAuthority = vi.fn();

    expect(
      validateLiveSandboxPolicyRequirements(
        {
          sandboxName: "alpha",
          gatewayName: "nemoclaw",
          liveExists: false,
          operation: "create a sandbox",
          prepareRequiredPolicy,
        },
        { inspectSandboxPolicyAuthority },
      ),
    ).toEqual({ valid: true });
    expect(prepareRequiredPolicy).not.toHaveBeenCalled();
    expect(inspectSandboxPolicyAuthority).not.toHaveBeenCalled();
  });

  it("cleans the bounded required-policy artifact when live inspection fails", () => {
    const cleanup = vi.fn(() => true);

    expect(() =>
      validateLiveSandboxPolicyRequirements(
        {
          sandboxName: "alpha",
          gatewayName: "nemoclaw",
          liveExists: true,
          operation: "continue onboarding",
          prepareRequiredPolicy: () => ({
            policyPath: "/tmp/required-policy.yaml",
            appliedPresets: [],
            sourceBytes: Buffer.from("version: 1\nnetwork_policies: {}\n"),
            cleanup,
          }),
        },
        {
          inspectSandboxPolicyAuthority: vi.fn(() => {
            throw new Error("live policy unavailable");
          }),
        },
      ),
    ).toThrow("live policy unavailable");
    expect(cleanup).toHaveBeenCalledOnce();
  });
});

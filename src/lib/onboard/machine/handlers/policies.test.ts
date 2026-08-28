// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";

import { handlePoliciesState } from "./policies";
import { basePolicyHandlerOptions, createPolicyHandlerDeps } from "./policies-test-fixture";

describe("handlePoliciesState live policy boundary", () => {
  it("stops before policy-dependent effects when the live policy is unreadable", async () => {
    const { deps, calls } = createPolicyHandlerDeps({
      getAppliedPolicyPresets: vi.fn(() => {
        throw new Error("live policy unavailable");
      }),
    });

    await expect(handlePoliciesState(basePolicyHandlerOptions(deps))).rejects.toThrow(
      "live policy unavailable",
    );
    expect(calls.smoke).not.toHaveBeenCalled();
    expect(calls.startStep).not.toHaveBeenCalled();
    expect(calls.setupPolicies).not.toHaveBeenCalled();
  });

  it("resumes from the applied live preset set without writing a session shadow", async () => {
    const updateSession = vi.fn();
    const { deps, calls } = createPolicyHandlerDeps({
      getAppliedPolicyPresets: vi.fn(() => ["npm"]),
      arePolicyPresetsApplied: vi.fn(() => true),
      updateSession,
    });

    const result = await handlePoliciesState({
      ...basePolicyHandlerOptions(deps),
      resume: true,
    });

    expect(calls.prepareResume).toHaveBeenCalledWith(
      "my-assistant",
      expect.objectContaining({ recordedPolicyPresets: ["npm"] }),
    );
    expect(calls.setupPolicies).not.toHaveBeenCalled();
    expect(updateSession).not.toHaveBeenCalled();
    expect(result.appliedPolicyPresets).toEqual(["npm"]);
  });

  it("passes the live applied set into reconciliation and records no durable policy fields", async () => {
    const setupPolicies = vi.fn(async () => ["npm", "github"]);
    const { deps, calls } = createPolicyHandlerDeps({
      getAppliedPolicyPresets: vi.fn(() => ["npm"]),
      setupPoliciesWithSelection: setupPolicies,
    });

    const result = await handlePoliciesState(basePolicyHandlerOptions(deps));

    expect(setupPolicies).toHaveBeenCalledWith(
      "my-assistant",
      expect.objectContaining({ selectedPresets: ["npm"] }),
    );
    expect(calls.complete).toHaveBeenCalledWith(
      "policies",
      expect.not.objectContaining({ policyPresets: expect.anything() }),
    );
    expect(result.appliedPolicyPresets).toEqual(["npm", "github"]);
  });
});

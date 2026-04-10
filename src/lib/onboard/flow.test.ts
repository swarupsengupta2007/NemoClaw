// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

import { createOnboardFlowHelpers } from "./flow";

describe("onboard/flow", () => {
  const originalExit = process.exit;

  afterEach(() => {
    process.exit = originalExit;
    delete process.env.NEMOCLAW_NON_INTERACTIVE;
    delete process.env.NEMOCLAW_RECREATE_SANDBOX;
  });

  function baseDeps() {
    return {
      GATEWAY_NAME: "nemoclaw",
      agentOnboard: { resolveAgent: vi.fn(() => null), handleAgentSetup: vi.fn() },
      arePolicyPresetsApplied: vi.fn(() => false),
      buildSandboxConfigSyncScript: vi.fn(),
      cleanupTempDir: vi.fn(),
      configureWebSearch: vi.fn(),
      createSandbox: vi.fn(),
      ensureUsageNoticeConsent: vi.fn(async () => true),
      ensureValidatedBraveSearchCredential: vi.fn(),
      getGatewayReuseState: vi.fn(() => "healthy"),
      getOpenshellBinary: vi.fn(() => "/usr/bin/openshell"),
      getResumeConfigConflicts: vi.fn(() => []),
      getSandboxReuseState: vi.fn(() => "ready"),
      hydrateCredentialEnv: vi.fn(),
      isInferenceRouteReady: vi.fn(() => true),
      isNonInteractive: vi.fn(() => false),
      isOpenclawReady: vi.fn(() => true),
      nim: { detectGpu: vi.fn(() => null) },
      note: vi.fn(),
      onboardSession: {
        acquireOnboardLock: vi.fn(() => ({ acquired: true })),
        createSession: vi.fn((value) => value),
        loadSession: vi.fn(() => ({ steps: {}, metadata: {} })),
        markStepComplete: vi.fn(),
        markStepFailed: vi.fn(),
        releaseOnboardLock: vi.fn(),
        saveSession: vi.fn((value) => value),
        updateSession: vi.fn(),
        completeSession: vi.fn(),
      },
      openshellShellCommand: vi.fn(),
      preflight: vi.fn(async () => null),
      printDashboard: vi.fn(),
      registry: { updateSandbox: vi.fn(), removeSandbox: vi.fn() },
      repairRecordedSandbox: vi.fn(),
      runCaptureOpenshell: vi.fn(() => "output"),
      setNonInteractiveFlag: vi.fn(),
      setRecreateSandboxFlag: vi.fn(),
      setupInference: vi.fn(async () => ({ ok: true })),
      setupMessagingChannels: vi.fn(async () => []),
      setupNim: vi.fn(async () => ({ model: "model-a", provider: "provider-a" })),
      setupOpenclaw: vi.fn(),
      setupPoliciesWithSelection: vi.fn(async () => []),
      skippedStepMessage: vi.fn(),
      startGateway: vi.fn(async () => {}),
      startRecordedStep: vi.fn(),
      step: vi.fn(),
      writeSandboxConfigSyncFile: vi.fn(),
    };
  }

  it("exits when the usage notice is not accepted", async () => {
    const deps = baseDeps();
    deps.ensureUsageNoticeConsent = vi.fn(async () => false);
    const helpers = createOnboardFlowHelpers(deps);
    process.exit = vi.fn((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never;

    await expect(helpers.onboard({})).rejects.toThrow("exit:1");
  });

  it("exits when a lock cannot be acquired or resume state is missing", async () => {
    const deps = baseDeps();
    deps.onboardSession.acquireOnboardLock = vi.fn(() => ({
      acquired: false,
      lockFile: "/tmp/lock",
    }));
    const helpers = createOnboardFlowHelpers(deps);
    process.exit = vi.fn((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never;
    await expect(helpers.onboard({})).rejects.toThrow("exit:1");

    const depsResume = baseDeps();
    depsResume.onboardSession.loadSession = vi.fn(() => null);
    const resumeHelpers = createOnboardFlowHelpers(depsResume);
    await expect(resumeHelpers.onboard({ resume: true })).rejects.toThrow("exit:1");
  });
});

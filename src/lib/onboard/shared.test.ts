// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

import { createOnboardSharedHelpers } from "./shared";

describe("onboard/shared", () => {
  afterEach(() => {
    delete process.env.NEMOCLAW_SANDBOX_NAME;
    delete process.env.NEMOCLAW_PROVIDER;
    delete process.env.NEMOCLAW_MODEL;
  });

  it("normalizes requested sandbox and provider/model hints", () => {
    const helpers = createOnboardSharedHelpers({
      DIM: "",
      RESET: "",
      getCredential: vi.fn(),
      getNonInteractiveFlag: () => true,
      getRecreateSandboxFlag: () => false,
      onboardSession: { markStepStarted: vi.fn(), updateSession: vi.fn() },
      prompt: vi.fn(),
    });

    process.env.NEMOCLAW_SANDBOX_NAME = "  My-Assistant  ";
    process.env.NEMOCLAW_PROVIDER = "cloud";
    process.env.NEMOCLAW_MODEL = "nvidia/test-model";

    expect(helpers.getRequestedSandboxNameHint()).toBe("my-assistant");
    expect(helpers.getRequestedProviderHint(true)).toBe("build");
    expect(helpers.getRequestedModelHint(true)).toBe("nvidia/test-model");
  });

  it("computes resume conflicts and records started steps", () => {
    const markStepStarted = vi.fn();
    const updateSession = vi.fn((updater) =>
      updater({ sandboxName: null, provider: null, model: null }),
    );
    const helpers = createOnboardSharedHelpers({
      DIM: "",
      RESET: "",
      getCredential: vi.fn(),
      getNonInteractiveFlag: () => true,
      getRecreateSandboxFlag: () => false,
      onboardSession: { markStepStarted, updateSession },
      prompt: vi.fn(),
    });

    process.env.NEMOCLAW_SANDBOX_NAME = "other-sandbox";
    process.env.NEMOCLAW_PROVIDER = "build";
    process.env.NEMOCLAW_MODEL = "nvidia/other-model";

    expect(helpers.getResumeSandboxConflict({ sandboxName: "my-assistant" })).toEqual({
      requestedSandboxName: "other-sandbox",
      recordedSandboxName: "my-assistant",
    });
    expect(
      helpers.getResumeConfigConflicts(
        {
          sandboxName: "my-assistant",
          provider: "nvidia-nim",
          model: "nvidia/nemotron-3-super-120b-a12b",
          metadata: { fromDockerfile: null },
        },
        { nonInteractive: true },
      ),
    ).toEqual([
      { field: "sandbox", requested: "other-sandbox", recorded: "my-assistant" },
      { field: "provider", requested: "nvidia-prod", recorded: "nvidia-nim" },
      {
        field: "model",
        requested: "nvidia/other-model",
        recorded: "nvidia/nemotron-3-super-120b-a12b",
      },
    ]);

    helpers.startRecordedStep("sandbox", {
      sandboxName: "sandbox-a",
      provider: "nvidia-prod",
      model: "gpt",
    });
    expect(markStepStarted).toHaveBeenCalledWith("sandbox");
    expect(updateSession).toHaveBeenCalled();
  });
});

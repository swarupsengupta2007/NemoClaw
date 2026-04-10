// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

import { createOnboardPolicyHelpers } from "./policies";

describe("onboard/policies", () => {
  afterEach(() => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.DISCORD_BOT_TOKEN;
    delete process.env.NEMOCLAW_POLICY_MODE;
  });

  it("suggests presets from enabled channels and applied presets", () => {
    const helpers = createOnboardPolicyHelpers({
      USE_COLOR: false,
      getCredential: vi.fn((envKey: string) =>
        envKey === "DISCORD_BOT_TOKEN" ? "discord-token" : null,
      ),
      isNonInteractive: () => false,
      note: vi.fn(),
      parsePolicyPresetEnv: vi.fn(() => []),
      policies: {
        getAppliedPresets: vi.fn(() => ["npm"]),
        listPresets: vi.fn(() => []),
      },
      prompt: vi.fn(),
      sleep: vi.fn(),
      step: vi.fn(),
      waitForSandboxReady: vi.fn(() => true),
    });

    expect(
      helpers.getSuggestedPolicyPresets({
        enabledChannels: ["telegram"],
        webSearchConfig: { fetchEnabled: true },
      }),
    ).toEqual(["pypi", "npm", "telegram", "brave"]);
    expect(helpers.arePolicyPresetsApplied("sandbox-a", ["npm"])).toBe(true);
  });

  it("skips non-interactive policy application when requested", async () => {
    process.env.NEMOCLAW_POLICY_MODE = "skip";
    const note = vi.fn();
    const helpers = createOnboardPolicyHelpers({
      USE_COLOR: false,
      getCredential: vi.fn(() => null),
      isNonInteractive: () => true,
      note,
      parsePolicyPresetEnv: vi.fn(() => []),
      policies: {
        applyPreset: vi.fn(),
        getAppliedPresets: vi.fn(() => []),
        listPresets: vi.fn(() => [{ name: "npm", description: "npm" }]),
      },
      prompt: vi.fn(),
      sleep: vi.fn(),
      step: vi.fn(),
      waitForSandboxReady: vi.fn(() => true),
    });

    await expect(helpers.setupPoliciesWithSelection("sandbox-a")).resolves.toEqual([]);
    expect(note).toHaveBeenCalledWith("  [non-interactive] Skipping policy presets.");
  });
});

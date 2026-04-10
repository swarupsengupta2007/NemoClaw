// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

import { createOnboardCredentialHelpers } from "./credentials";

describe("onboard/credentials", () => {
  const originalExit = process.exit;

  afterEach(() => {
    process.exit = originalExit;
    delete process.env.NVIDIA_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  it("reuses an existing credential without prompting", async () => {
    const prompt = vi.fn();
    const helpers = createOnboardCredentialHelpers({
      exitOnboardFromPrompt: vi.fn(),
      getCredential: vi.fn(() => "saved-key"),
      getTransportRecoveryMessage: vi.fn(),
      isNonInteractive: () => false,
      normalizeCredentialValue: (value: string) => value,
      prompt,
      saveCredential: vi.fn(),
      validateNvidiaApiKeyValue: vi.fn(),
    });

    await expect(helpers.ensureNamedCredential("OPENAI_API_KEY", "OpenAI API key")).resolves.toBe(
      "saved-key",
    );
    expect(prompt).not.toHaveBeenCalled();
    expect(process.env.OPENAI_API_KEY).toBe("saved-key");
  });

  it("re-prompts credentials and returns credential recovery", async () => {
    const prompt = vi.fn().mockResolvedValueOnce("").mockResolvedValueOnce("nvapi-test-key");
    const saveCredential = vi.fn();
    const helpers = createOnboardCredentialHelpers({
      exitOnboardFromPrompt: vi.fn(),
      getCredential: vi.fn(() => null),
      getTransportRecoveryMessage: vi.fn(),
      isNonInteractive: () => false,
      normalizeCredentialValue: (value: string) => value.trim(),
      prompt,
      saveCredential,
      validateNvidiaApiKeyValue: vi.fn(() => null),
    });

    await expect(
      helpers.promptValidationRecovery(
        "NVIDIA Endpoints",
        { kind: "credential" },
        "NVIDIA_API_KEY",
        "https://example.test/key",
      ),
    ).resolves.toBe("credential");
    expect(saveCredential).toHaveBeenCalledWith("NVIDIA_API_KEY", "nvapi-test-key");
    expect(process.env.NVIDIA_API_KEY).toBe("nvapi-test-key");
  });
});

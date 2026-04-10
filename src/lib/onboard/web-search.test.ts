// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

import { createOnboardWebSearchHelpers } from "./web-search";

describe("onboard/web-search", () => {
  afterEach(() => {
    delete process.env.BRAVE_API_KEY;
  });

  it("returns null in non-interactive mode when no Brave API key is configured", async () => {
    const helpers = createOnboardWebSearchHelpers({
      BRAVE_SEARCH_HELP_URL: "https://brave.example",
      classifyValidationFailure: vi.fn(),
      exitOnboardFromPrompt: vi.fn(),
      getCredential: vi.fn(() => null),
      getTransportRecoveryMessage: vi.fn(),
      isAffirmativeAnswer: vi.fn(),
      isNonInteractive: () => true,
      normalizeCredentialValue: (value: string | undefined) => value?.trim() || "",
      note: vi.fn(),
      prompt: vi.fn(),
      runCurlProbe: vi.fn(),
      saveCredential: vi.fn(),
      webSearch: {
        BRAVE_API_KEY_ENV: "BRAVE_API_KEY",
        getBraveExposureWarningLines: vi.fn(() => []),
      },
    });

    await expect(helpers.configureWebSearch(null)).resolves.toBeNull();
  });

  it("validates and stores Brave API keys", async () => {
    const saveCredential = vi.fn();
    const runCurlProbe = vi.fn(() => ({ ok: true }));
    const helpers = createOnboardWebSearchHelpers({
      BRAVE_SEARCH_HELP_URL: "https://brave.example",
      classifyValidationFailure: vi.fn(),
      exitOnboardFromPrompt: vi.fn(),
      getCredential: vi.fn(() => null),
      getTransportRecoveryMessage: vi.fn(),
      isAffirmativeAnswer: vi.fn(() => true),
      isNonInteractive: () => true,
      normalizeCredentialValue: (value: string | undefined) => value?.trim() || "",
      note: vi.fn(),
      prompt: vi.fn(),
      runCurlProbe,
      saveCredential,
      webSearch: {
        BRAVE_API_KEY_ENV: "BRAVE_API_KEY",
        getBraveExposureWarningLines: vi.fn(() => ["warning line"]),
      },
    });

    process.env.BRAVE_API_KEY = "brave-key";
    await expect(helpers.configureWebSearch(null)).resolves.toEqual({ fetchEnabled: true });
    expect(saveCredential).toHaveBeenCalledWith("BRAVE_API_KEY", "brave-key");
    expect(runCurlProbe).toHaveBeenCalled();
  });
});

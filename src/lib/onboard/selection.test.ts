// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

import { createOnboardSelectionHelpers } from "./selection";

describe("onboard/selection", () => {
  const originalExit = process.exit;

  afterEach(() => {
    process.exit = originalExit;
    delete process.env.NEMOCLAW_PROVIDER;
    delete process.env.NEMOCLAW_MODEL;
  });

  it("normalizes non-interactive provider aliases", () => {
    process.env.NEMOCLAW_PROVIDER = "cloud";
    process.env.NEMOCLAW_MODEL = "model-a";
    const helpers = createOnboardSelectionHelpers({
      ANTHROPIC_ENDPOINT_URL: "https://api.anthropic.com",
      BACK_TO_SELECTION: "__BACK__",
      DEFAULT_CLOUD_MODEL: "model-a",
      EXPERIMENTAL: false,
      GATEWAY_NAME: "nemoclaw",
      REMOTE_PROVIDER_CONFIG: {
        build: {
          providerName: "nvidia-prod",
          endpointUrl: "https://build",
          credentialEnv: "NVIDIA_API_KEY",
        },
      },
      ROOT: process.cwd(),
      ensureApiKey: vi.fn(),
      ensureNamedCredential: vi.fn(),
      exitOnboardFromPrompt: vi.fn(),
      getBootstrapOllamaModelOptions: vi.fn(() => []),
      getCredential: vi.fn(() => null),
      getDefaultOllamaModel: vi.fn(() => "llama3"),
      getLocalProviderBaseUrl: vi.fn(),
      getLocalProviderValidationBaseUrl: vi.fn(),
      getNavigationChoice: vi.fn(),
      getOllamaModelOptions: vi.fn(() => []),
      getOllamaWarmupCommand: vi.fn(),
      isNonInteractive: () => true,
      isSafeModelId: vi.fn(() => true),
      isWsl: vi.fn(() => false),
      nim: { detectGpu: vi.fn(), listModels: vi.fn() },
      normalizeProviderBaseUrl: vi.fn(),
      note: vi.fn(),
      prompt: vi.fn(),
      promptCloudModel: vi.fn(),
      promptInputModel: vi.fn(),
      promptManualModelId: vi.fn(),
      promptRemoteModel: vi.fn(),
      run: vi.fn(),
      runCapture: vi.fn(() => ""),
      shellQuote: vi.fn(),
      shouldRequireResponsesToolCalling: vi.fn(() => false),
      shouldSkipResponsesProbe: vi.fn(() => false),
      sleep: vi.fn(),
      step: vi.fn(),
      validateAnthropicModel: vi.fn(),
      validateAnthropicSelectionWithRetryMessage: vi.fn(),
      validateCustomAnthropicSelection: vi.fn(),
      validateCustomOpenAiLikeSelection: vi.fn(),
      validateNvidiaApiKeyValue: vi.fn(() => null),
      validateOllamaModel: vi.fn(() => ({ ok: true })),
      validateOpenAiLikeModel: vi.fn(),
      validateOpenAiLikeSelection: vi.fn(),
    });

    expect(helpers.getNonInteractiveProvider()).toBe("build");
    expect(helpers.getNonInteractiveModel("build")).toBe("model-a");
  });

  it("warms and validates already-installed Ollama models", () => {
    const run = vi.fn();
    const helpers = createOnboardSelectionHelpers({
      ANTHROPIC_ENDPOINT_URL: "https://api.anthropic.com",
      BACK_TO_SELECTION: "__BACK__",
      DEFAULT_CLOUD_MODEL: "model-a",
      EXPERIMENTAL: false,
      GATEWAY_NAME: "nemoclaw",
      REMOTE_PROVIDER_CONFIG: {},
      ROOT: process.cwd(),
      ensureApiKey: vi.fn(),
      ensureNamedCredential: vi.fn(),
      exitOnboardFromPrompt: vi.fn(),
      getBootstrapOllamaModelOptions: vi.fn(() => []),
      getCredential: vi.fn(() => null),
      getDefaultOllamaModel: vi.fn(() => "llama3"),
      getLocalProviderBaseUrl: vi.fn(),
      getLocalProviderValidationBaseUrl: vi.fn(),
      getNavigationChoice: vi.fn(),
      getOllamaModelOptions: vi.fn(() => []),
      getOllamaWarmupCommand: vi.fn(() => "ollama run llama3"),
      isNonInteractive: () => false,
      isSafeModelId: vi.fn(() => true),
      isWsl: vi.fn(() => false),
      nim: { detectGpu: vi.fn(), listModels: vi.fn() },
      normalizeProviderBaseUrl: vi.fn(),
      note: vi.fn(),
      prompt: vi.fn(),
      promptCloudModel: vi.fn(),
      promptInputModel: vi.fn(),
      promptManualModelId: vi.fn(),
      promptRemoteModel: vi.fn(),
      run,
      runCapture: vi.fn(() => ""),
      shellQuote: (value: string) => value,
      shouldRequireResponsesToolCalling: vi.fn(() => false),
      shouldSkipResponsesProbe: vi.fn(() => false),
      sleep: vi.fn(),
      step: vi.fn(),
      validateAnthropicModel: vi.fn(),
      validateAnthropicSelectionWithRetryMessage: vi.fn(),
      validateCustomAnthropicSelection: vi.fn(),
      validateCustomOpenAiLikeSelection: vi.fn(),
      validateNvidiaApiKeyValue: vi.fn(() => null),
      validateOllamaModel: vi.fn(() => ({ ok: true })),
      validateOpenAiLikeModel: vi.fn(),
      validateOpenAiLikeSelection: vi.fn(),
    });

    expect(helpers.prepareOllamaModel("llama3", ["llama3"])).toEqual({ ok: true });
    expect(run).toHaveBeenCalledWith("ollama run llama3", { ignoreError: true });
  });
});

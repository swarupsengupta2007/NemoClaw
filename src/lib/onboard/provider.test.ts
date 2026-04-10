// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";

import { createOnboardProviderHelpers } from "./provider";

describe("onboard/provider", () => {
  it("builds provider args and falls back from create to update", async () => {
    const runOpenshell = vi
      .fn()
      .mockReturnValueOnce({ status: 1, stderr: "AlreadyExists" })
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 0 });
    const helpers = createOnboardProviderHelpers({
      GATEWAY_NAME: "nemoclaw",
      LOCAL_INFERENCE_TIMEOUT_SECS: 180,
      REMOTE_PROVIDER_CONFIG: { build: { providerName: "nvidia-prod" } },
      classifyApplyFailure: vi.fn(),
      compactText: (value: string) => value.trim(),
      getLocalProviderBaseUrl: vi.fn(),
      getOllamaWarmupCommand: vi.fn(),
      hydrateCredentialEnv: vi.fn(() => "saved-key"),
      isNonInteractive: () => false,
      parseGatewayInference: vi.fn(() => ({ provider: "provider-a", model: "model-a" })),
      promptValidationRecovery: vi.fn(),
      registry: { updateSandbox: vi.fn() },
      run: vi.fn(),
      runCapture: vi.fn(),
      runCaptureOpenshell: vi.fn(() => "Gateway inference configured"),
      runOpenshell,
      step: vi.fn(),
      validateLocalProvider: vi.fn(),
      validateOllamaModel: vi.fn(),
    });

    expect(
      helpers.buildProviderArgs("create", "provider-a", "openai", "OPENAI_API_KEY", "https://base"),
    ).toEqual([
      "provider",
      "create",
      "--name",
      "provider-a",
      "--type",
      "openai",
      "--credential",
      "OPENAI_API_KEY",
      "--config",
      "OPENAI_BASE_URL=https://base",
    ]);

    expect(
      helpers.upsertProvider("provider-a", "openai", "OPENAI_API_KEY", "https://base"),
    ).toEqual({ ok: true });
    expect(helpers.providerExistsInGateway("provider-a")).toBe(true);
  });

  it("recognizes a ready inference route", () => {
    const helpers = createOnboardProviderHelpers({
      GATEWAY_NAME: "nemoclaw",
      LOCAL_INFERENCE_TIMEOUT_SECS: 180,
      REMOTE_PROVIDER_CONFIG: {},
      classifyApplyFailure: vi.fn(),
      compactText: vi.fn(),
      getLocalProviderBaseUrl: vi.fn(),
      getOllamaWarmupCommand: vi.fn(),
      hydrateCredentialEnv: vi.fn(),
      isNonInteractive: () => false,
      parseGatewayInference: vi.fn(() => ({ provider: "provider-a", model: "model-a" })),
      promptValidationRecovery: vi.fn(),
      registry: { updateSandbox: vi.fn() },
      run: vi.fn(),
      runCapture: vi.fn(),
      runCaptureOpenshell: vi.fn(() => "inference output"),
      runOpenshell: vi.fn(),
      step: vi.fn(),
      validateLocalProvider: vi.fn(),
      validateOllamaModel: vi.fn(),
    });

    expect(helpers.isInferenceRouteReady("provider-a", "model-a")).toBe(true);
    expect(helpers.isInferenceRouteReady("provider-b", "model-a")).toBe(false);
  });
});

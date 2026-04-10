// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";

import { createOnboardProviderValidationHelpers } from "./provider-validation";

describe("onboard/provider-validation", () => {
  it("parses tool calls from responses payloads", () => {
    const helpers = createOnboardProviderValidationHelpers({
      getCredential: vi.fn(),
      getCurlTimingArgs: vi.fn(() => ["--connect-timeout", "10", "--max-time", "60"]),
      getProbeRecovery: vi.fn(),
      isNonInteractive: () => false,
      isNvcfFunctionNotFoundForAccount: vi.fn(() => false),
      normalizeCredentialValue: (value: string) => value,
      nvcfFunctionNotFoundMessage: vi.fn(),
      promptValidationRecovery: vi.fn(),
      runCurlProbe: vi.fn(),
    });

    expect(helpers.parseJsonObject('{"ok":true}')).toEqual({ ok: true });
    expect(
      helpers.hasResponsesToolCall(
        JSON.stringify({ output: [{ content: [{ type: "tool_call", name: "emit_ok" }] }] }),
      ),
    ).toBe(true);
    expect(helpers.shouldRequireResponsesToolCalling("gemini-api")).toBe(true);
    expect(helpers.shouldRequireResponsesToolCalling("anthropic-prod")).toBe(false);
  });

  it("detects account-scoped NVCF failures from probe responses", () => {
    const runCurlProbe = vi
      .fn()
      .mockReturnValueOnce({
        ok: false,
        httpStatus: 404,
        curlStatus: 0,
        message: "missing",
        body: "nvcf account missing",
      })
      .mockReturnValueOnce({
        ok: false,
        httpStatus: 404,
        curlStatus: 0,
        message: "missing too",
        body: "nvcf account missing",
      });
    const helpers = createOnboardProviderValidationHelpers({
      getCredential: vi.fn(),
      getCurlTimingArgs: vi.fn(() => ["--connect-timeout", "10", "--max-time", "60"]),
      getProbeRecovery: vi.fn(),
      isNonInteractive: () => false,
      isNvcfFunctionNotFoundForAccount: vi.fn((value: string) =>
        String(value).includes("account missing"),
      ),
      normalizeCredentialValue: (value: string) => value,
      nvcfFunctionNotFoundMessage: vi.fn((model: string) => `no account for ${model}`),
      promptValidationRecovery: vi.fn(),
      runCurlProbe,
    });

    expect(helpers.probeOpenAiLikeEndpoint("https://example.test/v1", "model-a", "key")).toEqual(
      expect.objectContaining({ ok: false, message: "no account for model-a" }),
    );
  });
});

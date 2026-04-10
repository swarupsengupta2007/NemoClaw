// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createOnboardSandboxHelpers } from "./sandbox";

describe("onboard/sandbox", () => {
  it("builds the sandbox sync script and writes it securely", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "onboard-sandbox-"));
    const helpers = createOnboardSandboxHelpers({
      CONTROL_UI_PORT: 18789,
      DISCORD_SNOWFLAKE_RE: /^[0-9]{17,19}$/,
      GATEWAY_NAME: "nemoclaw",
      ROOT: process.cwd(),
      SCRIPTS: process.cwd(),
      MESSAGING_CHANNELS: [],
      REMOTE_PROVIDER_CONFIG: {},
      agentOnboard: {},
      classifySandboxCreateFailure: vi.fn(),
      ensureDashboardForward: vi.fn(),
      fetchGatewayAuthTokenFromSandbox: vi.fn(() => "token"),
      formatEnvAssignment: vi.fn(),
      getCredential: vi.fn(),
      getSandboxStateFromOutputs: vi.fn(() => "ready"),
      isNonInteractive: () => false,
      isRecreateSandbox: () => false,
      isSandboxReady: vi.fn(),
      normalizeCredentialValue: vi.fn(),
      note: vi.fn(),
      openshellShellCommand: vi.fn(),
      patchStagedDockerfile: vi.fn(),
      printSandboxCreateRecoveryHints: vi.fn(),
      promptOrDefault: vi.fn(),
      providerExistsInGateway: vi.fn(),
      registry: { getSandbox: vi.fn(), removeSandbox: vi.fn() },
      run: vi.fn(),
      runCapture: vi.fn(),
      runCaptureOpenshell: vi.fn(() => "running"),
      runOpenshell: vi.fn(),
      secureTempFile: vi.fn(() => path.join(tmpDir, "sync.sh")),
      shellQuote: vi.fn(),
      sleep: vi.fn(),
      stageOptimizedSandboxBuildContext: vi.fn(),
      step: vi.fn(),
      streamSandboxCreate: vi.fn(),
      upsertMessagingProviders: vi.fn(),
      webSearch: { BRAVE_API_KEY_ENV: "BRAVE_API_KEY" },
    });

    const script = helpers.buildSandboxConfigSyncScript({
      model: "model-a",
      provider: "provider-a",
    });
    expect(script).toContain("~/.nemoclaw/config.json");
    expect(script).toContain('"model": "model-a"');

    const filePath = helpers.writeSandboxConfigSyncFile(script);
    expect(fs.readFileSync(filePath, "utf-8")).toContain(script);
    expect(helpers.isOpenclawReady("sandbox-a")).toBe(true);
  });

  it("reports the recorded sandbox reuse state", () => {
    const helpers = createOnboardSandboxHelpers({
      CONTROL_UI_PORT: 18789,
      DISCORD_SNOWFLAKE_RE: /^[0-9]{17,19}$/,
      GATEWAY_NAME: "nemoclaw",
      ROOT: process.cwd(),
      SCRIPTS: process.cwd(),
      MESSAGING_CHANNELS: [],
      REMOTE_PROVIDER_CONFIG: {},
      agentOnboard: {},
      classifySandboxCreateFailure: vi.fn(),
      ensureDashboardForward: vi.fn(),
      fetchGatewayAuthTokenFromSandbox: vi.fn(() => null),
      formatEnvAssignment: vi.fn(),
      getCredential: vi.fn(),
      getSandboxStateFromOutputs: vi.fn(() => "ready"),
      isNonInteractive: () => false,
      isRecreateSandbox: () => false,
      isSandboxReady: vi.fn(),
      normalizeCredentialValue: vi.fn(),
      note: vi.fn(),
      openshellShellCommand: vi.fn(),
      patchStagedDockerfile: vi.fn(),
      printSandboxCreateRecoveryHints: vi.fn(),
      promptOrDefault: vi.fn(),
      providerExistsInGateway: vi.fn(),
      registry: { getSandbox: vi.fn(() => ({ name: "sandbox-a" })), removeSandbox: vi.fn() },
      run: vi.fn(),
      runCapture: vi.fn(),
      runCaptureOpenshell: vi.fn(() => "output"),
      runOpenshell: vi.fn(),
      secureTempFile: vi.fn(),
      shellQuote: vi.fn(),
      sleep: vi.fn(),
      stageOptimizedSandboxBuildContext: vi.fn(),
      step: vi.fn(),
      streamSandboxCreate: vi.fn(),
      upsertMessagingProviders: vi.fn(),
      webSearch: { BRAVE_API_KEY_ENV: "BRAVE_API_KEY" },
    });

    expect(helpers.getSandboxReuseState("sandbox-a")).toBe("ready");
    expect(helpers.pruneStaleSandboxEntry("sandbox-a")).toBe(true);
  });
});

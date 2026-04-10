// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";

import { createOnboardOpenclawHelpers } from "./openclaw";

describe("onboard/openclaw", () => {
  it("runs the sandbox sync script when provider selection config exists", async () => {
    const run = vi.fn();
    const cleanupTempDir = vi.fn();
    const writeSandboxConfigSyncFile = vi.fn(() => "/tmp/script.sh");
    const helpers = createOnboardOpenclawHelpers({
      buildSandboxConfigSyncScript: vi.fn(() => "echo ok"),
      cleanupTempDir,
      getProviderSelectionConfig: vi.fn(() => ({ model: "model-a" })),
      openshellShellCommand: vi.fn(() => "openshell sandbox connect sandbox-a"),
      run,
      shellQuote: (value: string) => `'${value}'`,
      step: vi.fn(),
      writeSandboxConfigSyncFile,
    });

    await helpers.setupOpenclaw("sandbox-a", "model-a", "nvidia-prod");
    expect(writeSandboxConfigSyncFile).toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith("openshell sandbox connect sandbox-a < '/tmp/script.sh'", {
      stdio: ["ignore", "ignore", "inherit"],
    });
    expect(cleanupTempDir).toHaveBeenCalledWith("/tmp/script.sh", "nemoclaw-sync");
  });

  it("skips sandbox sync when no provider selection config exists", async () => {
    const run = vi.fn();
    const helpers = createOnboardOpenclawHelpers({
      buildSandboxConfigSyncScript: vi.fn(),
      cleanupTempDir: vi.fn(),
      getProviderSelectionConfig: vi.fn(() => null),
      openshellShellCommand: vi.fn(),
      run,
      shellQuote: vi.fn(),
      step: vi.fn(),
      writeSandboxConfigSyncFile: vi.fn(),
    });

    await helpers.setupOpenclaw("sandbox-a", "model-a", "nvidia-prod");
    expect(run).not.toHaveBeenCalled();
  });
});

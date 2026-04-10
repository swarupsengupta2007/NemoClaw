// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

import { createOnboardRuntimeHelpers } from "./runtime";

describe("onboard/runtime", () => {
  afterEach(() => {
    delete process.env.PATH;
    delete process.env.HOME;
    delete process.env.XDG_BIN_HOME;
  });

  it("parses versions and shell path hints", () => {
    const helpers = createOnboardRuntimeHelpers({
      GATEWAY_NAME: "nemoclaw",
      OPENCLAW_LAUNCH_AGENT_PLIST: "plist",
      ROOT: process.cwd(),
      SCRIPTS: process.cwd(),
      assessHost: vi.fn(),
      checkPortAvailable: vi.fn(),
      ensureSwap: vi.fn(),
      getGatewayReuseState: vi.fn(),
      getMemoryInfo: vi.fn(),
      getOpenshellBin: vi.fn(() => null),
      inferContainerRuntime: vi.fn(() => "docker"),
      isNonInteractive: () => false,
      nim: { detectGpu: vi.fn() },
      planHostRemediation: vi.fn(),
      prompt: vi.fn(),
      registry: { clearAll: vi.fn() },
      resolveOpenshell: vi.fn(() => "/usr/local/bin/openshell"),
      run: vi.fn(),
      runCapture: vi.fn(() => "openshell 0.0.25"),
      setOpenshellBin: vi.fn(),
      shellQuote: (value: string) => `'${value}'`,
      step: vi.fn(),
    });

    expect(helpers.getInstalledOpenshellVersion("openshell 0.0.13-dev.1")).toBe("0.0.13");
    expect(helpers.versionGte("0.1.0", "0.0.24")).toBe(true);
    expect(helpers.getStableGatewayImageRef("openshell 0.0.25")).toContain(":0.0.25");
    expect(helpers.getFutureShellPathHint("/tmp/bin", "/usr/bin:/bin")).toBe(
      'export PATH="/tmp/bin:$PATH"',
    );
    expect(helpers.getPortConflictServiceHints("darwin")).toContain(
      "       launchctl unload plist",
    );
  });

  it("returns the cached or resolved openshell binary", () => {
    const setOpenshellBin = vi.fn();
    const helpers = createOnboardRuntimeHelpers({
      GATEWAY_NAME: "nemoclaw",
      OPENCLAW_LAUNCH_AGENT_PLIST: "plist",
      ROOT: process.cwd(),
      SCRIPTS: process.cwd(),
      assessHost: vi.fn(),
      checkPortAvailable: vi.fn(),
      ensureSwap: vi.fn(),
      getGatewayReuseState: vi.fn(),
      getMemoryInfo: vi.fn(),
      getOpenshellBin: vi.fn(() => null),
      inferContainerRuntime: vi.fn(() => "docker"),
      isNonInteractive: () => false,
      nim: { detectGpu: vi.fn() },
      planHostRemediation: vi.fn(),
      prompt: vi.fn(),
      registry: { clearAll: vi.fn() },
      resolveOpenshell: vi.fn(() => "/resolved/openshell"),
      run: vi.fn(),
      runCapture: vi.fn(() => "openshell 0.0.25"),
      setOpenshellBin,
      shellQuote: (value: string) => `'${value}'`,
      step: vi.fn(),
    });

    expect(helpers.getOpenshellBinary()).toBe("/resolved/openshell");
    expect(setOpenshellBin).toHaveBeenCalledWith("/resolved/openshell");
    expect(helpers.openshellShellCommand(["status"])).toBe("'/resolved/openshell' 'status'");
  });
});

// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";

import { createOnboardGatewayHelpers } from "./gateway";

describe("onboard/gateway", () => {
  it("prunes known_hosts entries and clears registry on destroy", () => {
    const clearAll = vi.fn();
    const run = vi.fn();
    const runOpenshell = vi.fn(() => ({ status: 0 }));
    const helpers = createOnboardGatewayHelpers({
      GATEWAY_NAME: "nemoclaw",
      ROOT: process.cwd(),
      SCRIPTS: process.cwd(),
      compactText: vi.fn((value: string) => value),
      envInt: vi.fn((_: string, fallback: number) => fallback),
      getContainerRuntime: vi.fn(() => "docker"),
      getInstalledOpenshellVersion: vi.fn(() => "0.0.25"),
      hasStaleGateway: vi.fn(() => false),
      isGatewayHealthy: vi.fn(() => false),
      isSelectedGateway: vi.fn(() => false),
      openshellShellCommand: vi.fn(),
      redact: vi.fn((value: string) => value),
      registry: { clearAll },
      run,
      runCaptureOpenshell: vi.fn(() => ""),
      runOpenshell,
      shouldPatchCoredns: vi.fn(() => false),
      sleep: vi.fn(),
      step: vi.fn(),
    });

    expect(
      helpers.pruneKnownHostsEntries(
        [
          "openshell-nemoclaw ssh-ed25519 AAAA",
          "github.com ssh-rsa BBBB",
          "foo,openshell-other ssh-rsa CCCC",
        ].join("\n"),
      ),
    ).toBe("github.com ssh-rsa BBBB");

    helpers.destroyGateway();
    expect(clearAll).toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(expect.stringContaining("docker volume"), {
      ignoreError: true,
    });
  });

  it("pins the gateway image from the installed openshell version", () => {
    const helpers = createOnboardGatewayHelpers({
      GATEWAY_NAME: "nemoclaw",
      ROOT: process.cwd(),
      SCRIPTS: process.cwd(),
      compactText: vi.fn(),
      envInt: vi.fn((_: string, fallback: number) => fallback),
      getContainerRuntime: vi.fn(() => "docker"),
      getInstalledOpenshellVersion: vi.fn(() => "0.0.25"),
      hasStaleGateway: vi.fn(() => false),
      isGatewayHealthy: vi.fn(() => false),
      isSelectedGateway: vi.fn(() => false),
      openshellShellCommand: vi.fn(),
      redact: vi.fn((value: string) => value),
      registry: { clearAll: vi.fn() },
      run: vi.fn(),
      runCaptureOpenshell: vi.fn(),
      runOpenshell: vi.fn(),
      shouldPatchCoredns: vi.fn(() => false),
      sleep: vi.fn(),
      step: vi.fn(),
    });

    expect(helpers.getGatewayStartEnv()).toEqual({
      OPENSHELL_CLUSTER_IMAGE: "ghcr.io/nvidia/openshell/cluster:0.0.25",
      IMAGE_TAG: "0.0.25",
    });
  });
});

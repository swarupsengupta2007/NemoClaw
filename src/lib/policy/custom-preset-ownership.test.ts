// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

const { runCapture } = vi.hoisted(() => ({ runCapture: vi.fn() }));

vi.mock("../runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runner")>()),
  runCapture,
}));

import { customPresetOwnsNetworkPolicyKey } from "./index";

describe("customPresetOwnsNetworkPolicyKey", () => {
  beforeEach(() => runCapture.mockReset());

  it("recognizes a namespaced custom rule from current OpenShell policy", () => {
    runCapture.mockReturnValue(`version: 1
network_policies:
  nemoclaw_custom.shared-otel.0:
    endpoints:
      - host: collector.internal
        port: 4318
`);

    expect(customPresetOwnsNetworkPolicyKey("my-sandbox", "nemoclaw_custom.shared-otel.0")).toBe(
      true,
    );
    expect(runCapture).toHaveBeenCalledOnce();
  });

  it("returns false when the namespaced key is absent", () => {
    runCapture.mockReturnValue("version: 1\\nnetwork_policies: {}\\n");

    expect(customPresetOwnsNetworkPolicyKey("my-sandbox", "nemoclaw_custom.shared-otel.0")).toBe(
      false,
    );
  });

  it("rejects non-namespaced keys without reading live policy", () => {
    expect(customPresetOwnsNetworkPolicyKey("my-sandbox", "shared-otel")).toBe(false);
    expect(runCapture).not.toHaveBeenCalled();
  });
});

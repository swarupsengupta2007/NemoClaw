// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createOnboardDashboardHelpers } from "./dashboard";

describe("onboard/dashboard", () => {
  it("resolves nested openclaw.json files and starts dashboard forwarding", () => {
    const runOpenshell = vi.fn(() => ({ status: 0 }));
    const helpers = createOnboardDashboardHelpers({
      agentOnboard: { printDashboardUi: vi.fn() },
      buildControlUiUrls: vi.fn(() => ["http://localhost:18789/#token=abc"]),
      controlUiPort: 18789,
      nim: {
        nimStatus: vi.fn(() => ({ running: false })),
        nimStatusByName: vi.fn(() => ({ running: false })),
      },
      note: vi.fn(),
      resolveDashboardForwardTarget: vi.fn(() => "127.0.0.1:18789"),
      runOpenshell,
    });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "onboard-dashboard-"));
    const nested = path.join(tmpDir, "a", "b");
    fs.mkdirSync(nested, { recursive: true });
    const configPath = path.join(nested, "openclaw.json");
    fs.writeFileSync(configPath, "{}\n");

    expect(helpers.findOpenclawJsonPath(tmpDir)).toBe(configPath);
    helpers.ensureDashboardForward("sandbox-a");
    expect(runOpenshell).toHaveBeenNthCalledWith(1, ["forward", "stop", "18789"], {
      ignoreError: true,
    });
    expect(runOpenshell).toHaveBeenNthCalledWith(
      2,
      ["forward", "start", "--background", "127.0.0.1:18789", "sandbox-a"],
      { ignoreError: true, stdio: ["ignore", "ignore", "ignore"] },
    );
  });

  it("extracts gateway auth tokens from downloaded sandbox configs", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onboard-dashboard-token-"));
    const runOpenshell = vi.fn((args: string[]) => {
      const destDir = args[4];
      const nested = path.join(destDir, "nested");
      fs.mkdirSync(nested, { recursive: true });
      fs.writeFileSync(
        path.join(nested, "openclaw.json"),
        JSON.stringify({ gateway: { auth: { token: "secret-token" } } }),
      );
      return { status: 0 };
    });
    const helpers = createOnboardDashboardHelpers({
      agentOnboard: { printDashboardUi: vi.fn() },
      buildControlUiUrls: vi.fn(() => []),
      controlUiPort: 18789,
      nim: {
        nimStatus: vi.fn(() => ({ running: false })),
        nimStatusByName: vi.fn(() => ({ running: false })),
      },
      note: vi.fn(),
      resolveDashboardForwardTarget: vi.fn(),
      runOpenshell,
    });

    const token = helpers.fetchGatewayAuthTokenFromSandbox("sandbox-a");
    expect(token).toBe("secret-token");
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });
});

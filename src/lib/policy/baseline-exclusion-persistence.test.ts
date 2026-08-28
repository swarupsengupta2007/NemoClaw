// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";
import YAML from "yaml";

const mocks = vi.hoisted(() => ({
  captureSandboxBasePolicy: vi.fn(),
  getSandbox: vi.fn(),
  inspectSandboxPolicyAuthority: vi.fn(),
  resolveOpenshell: vi.fn(),
  run: vi.fn(),
  runCapture: vi.fn(),
  updateSandbox: vi.fn(),
}));

vi.mock("../adapters/openshell/policy-authority", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../adapters/openshell/policy-authority")>()),
  captureSandboxBasePolicy: mocks.captureSandboxBasePolicy,
  inspectSandboxPolicyAuthority: mocks.inspectSandboxPolicyAuthority,
}));

vi.mock("../adapters/openshell/resolve", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../adapters/openshell/resolve")>()),
  resolveOpenshell: mocks.resolveOpenshell,
}));

vi.mock("../runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runner")>()),
  run: mocks.run,
  runCapture: mocks.runCapture,
}));

vi.mock("../state/registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/registry")>()),
  getSandbox: mocks.getSandbox,
  updateSandbox: mocks.updateSandbox,
}));

import { digestBaselineEntry, getBaselineEntry } from "./baseline-exclusion";
import { excludeBaselineEntry, restoreBaselineEntry } from "./index";

const SANDBOX = "alpha";
const BASELINE = fs.readFileSync("agents/hermes/policy-additions.yaml", "utf8");
const KEY = "nous_research";
const ENTRY = getBaselineEntry(BASELINE, KEY)!;
const DIGEST = digestBaselineEntry(ENTRY);
const HOST_RULE = {
  endpoints: [{ host: "host-approved.example.com", port: 443 }],
};

function policy(networkPolicies: Record<string, unknown>): string {
  return YAML.stringify({ version: 1, network_policies: networkPolicies });
}

describe("live baseline exclusion and restoration", () => {
  let livePolicy: string;

  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    livePolicy = policy({ [KEY]: ENTRY, host_change: HOST_RULE });
    mocks.getSandbox.mockReturnValue({
      name: SANDBOX,
      agent: "hermes",
      gatewayName: "nemoclaw",
      gatewayPort: 8080,
    });
    mocks.resolveOpenshell.mockReturnValue("/usr/bin/openshell");
    mocks.runCapture.mockImplementation(() => livePolicy);
    mocks.captureSandboxBasePolicy.mockImplementation(() => livePolicy);
    mocks.run.mockImplementation((command: readonly string[]) => {
      const flag = command.indexOf("--policy");
      livePolicy = fs.readFileSync(command[flag + 1] as string, "utf8");
      return { status: 0 };
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("removes the reviewed key from current OpenShell policy and preserves host changes", () => {
    expect(excludeBaselineEntry(SANDBOX, KEY, DIGEST, { nonFatal: true })).toBe(true);

    const current = YAML.parse(livePolicy).network_policies;
    expect(current[KEY]).toBeUndefined();
    expect(current.host_change).toEqual(HOST_RULE);
    expect(mocks.updateSandbox).not.toHaveBeenCalled();
    expect(mocks.inspectSandboxPolicyAuthority).not.toHaveBeenCalled();
  });

  it("is idempotent when the live baseline key is already absent", () => {
    livePolicy = policy({ host_change: HOST_RULE });

    expect(excludeBaselineEntry(SANDBOX, KEY, DIGEST, { nonFatal: true })).toBe(true);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("refuses when the baseline changed after operator preview", () => {
    expect(excludeBaselineEntry(SANDBOX, KEY, "stale-digest", { nonFatal: true })).toBe(false);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("refuses to delete a host-modified same-key rule", () => {
    livePolicy = policy({
      [KEY]: { endpoints: [{ host: "operator.example.com", port: 443 }] },
      host_change: HOST_RULE,
    });

    expect(excludeBaselineEntry(SANDBOX, KEY, DIGEST, { nonFatal: true })).toBe(false);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("stops before mutation when current OpenShell policy is unreadable", () => {
    mocks.runCapture.mockImplementation(() => {
      throw new Error("gateway unavailable");
    });

    expect(excludeBaselineEntry(SANDBOX, KEY, DIGEST, { nonFatal: true })).toBe(false);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("restores the current release entry into live policy and preserves host changes", () => {
    livePolicy = policy({ host_change: HOST_RULE });

    expect(
      restoreBaselineEntry(SANDBOX, KEY, {
        nonFatal: true,
        expectedTargetDigest: DIGEST,
      }),
    ).toBe(true);

    const current = YAML.parse(livePolicy).network_policies;
    expect(current[KEY]).toEqual(ENTRY);
    expect(current.host_change).toEqual(HOST_RULE);
    expect(mocks.updateSandbox).not.toHaveBeenCalled();
  });

  it("refuses to overwrite a host-modified same-key rule during restore", () => {
    livePolicy = policy({
      [KEY]: { endpoints: [{ host: "operator.example.com", port: 443 }] },
    });

    expect(restoreBaselineEntry(SANDBOX, KEY, { nonFatal: true })).toBe(false);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("classifies an ambiguous write by rereading current OpenShell policy", () => {
    livePolicy = policy({ host_change: HOST_RULE });
    mocks.run.mockImplementation((command: readonly string[]) => {
      const flag = command.indexOf("--policy");
      livePolicy = fs.readFileSync(command[flag + 1] as string, "utf8");
      return { status: null, error: new Error("transport closed") };
    });

    expect(restoreBaselineEntry(SANDBOX, KEY, { nonFatal: true })).toBe(true);
    expect(YAML.parse(livePolicy).network_policies[KEY]).toEqual(ENTRY);
  });

  it("does not claim success when an ambiguous write cannot be proved by reread", () => {
    livePolicy = policy({ host_change: HOST_RULE });
    mocks.run.mockReturnValue({
      status: null,
      error: new Error("transport closed"),
    });

    expect(restoreBaselineEntry(SANDBOX, KEY, { nonFatal: true })).toBe(false);
    expect(YAML.parse(livePolicy).network_policies[KEY]).toBeUndefined();
  });
});

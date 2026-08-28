// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import YAML from "yaml";
import {
  createShieldsFlowHarness,
  type ShieldsFlowHarnessOptions,
} from "../../../test/helpers/shields-flow-harness";

const requireDist = createRequire(import.meta.url);
const shieldsModulePath = "./index.js";

let tmpDir: string;

function createHarness(options: ShieldsFlowHarnessOptions = {}) {
  return createShieldsFlowHarness(requireDist, tmpDir, options);
}

function stateDir(): string {
  return path.join(tmpDir, ".nemoclaw", "state");
}

function shieldsState(): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(stateDir(), "shields-openclaw.json"), "utf-8"),
  ) as Record<string, unknown>;
}

function transitionState(): Record<string, unknown> {
  const name = fs
    .readdirSync(stateDir())
    .find((candidate) => candidate.startsWith("shields-transition-openclaw-"));
  if (!name) throw new Error("Shields transition is missing");
  return JSON.parse(fs.readFileSync(path.join(stateDir(), name), "utf-8")) as Record<
    string,
    unknown
  >;
}

describe("shields command flow", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shields-flow-"));
    vi.stubEnv("HOME", tmpDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete require.cache[requireDist.resolve(shieldsModulePath)];
    delete require.cache[requireDist.resolve("./timer-bound-lock.js")];
    delete require.cache[requireDist.resolve("./transition-lock.js")];
    delete require.cache[requireDist.resolve("./permissive-runtime.js")];
    delete require.cache[requireDist.resolve("../actions/sandbox/mcp-bridge-policy.js")];
    delete require.cache[requireDist.resolve("../cli/branding.js")];
  });

  it("captures live policy and publishes a bounded forward policy before unlocking", () => {
    const harness = createHarness({ confirmOpenClawInodeFlags: true });

    harness.shieldsDown("openclaw", {
      timeout: "5m",
      reason: "live policy coverage",
      throwOnError: true,
    });

    expect(shieldsState()).toMatchObject({
      shieldsDown: true,
      shieldsDownTimeout: 300,
      shieldsDownReason: "live policy coverage",
      shieldsDownPolicy: "permissive",
    });
    const transition = transitionState();
    expect(transition).toMatchObject({
      phase: "active",
      sandboxName: "openclaw",
    });
    const forwardPolicy = transition.forwardPolicy as {
      path: string;
      mode: number;
    };
    expect(forwardPolicy.mode).toBe(0o600);
    expect(fs.statSync(forwardPolicy.path).mode & 0o777).toBe(0o600);
    expect(harness.isShieldsDown("openclaw")).toBe(true);
    expect(harness.getOpenClawPosture()).toBe("mutable");
  });

  it("restores only the Shields delta and preserves a host policy change", () => {
    const harness = createHarness({ confirmOpenClawInodeFlags: true });
    harness.shieldsDown("openclaw", { timeout: "5m", throwOnError: true });

    const relaxed = YAML.parse(harness.policySetBodies.at(-1)!) as Record<string, unknown>;
    const current = {
      ...relaxed,
      network_policies: {
        ...((relaxed.network_policies as Record<string, unknown>) ?? {}),
        operator_added: {
          endpoints: [{ host: "operator.example.com", port: 443 }],
        },
      },
    };
    harness.runCaptureSpy.mockReturnValue(YAML.stringify(current));

    harness.shieldsUp("openclaw", { throwOnError: true });

    const restored = YAML.parse(harness.policySetBodies.at(-1)!) as {
      network_policies: Record<string, unknown>;
    };
    expect(restored.network_policies).toMatchObject({
      test: {},
      operator_added: {
        endpoints: [{ host: "operator.example.com", port: 443 }],
      },
    });
    expect(harness.getOpenClawPosture()).toBe("locked");
    expect(harness.isShieldsDown("openclaw")).toBe(false);
    expect(
      fs
        .readdirSync(stateDir())
        .filter((name) =>
          /^(policy-snapshot-|shields-forward-policy-|shields-transition-openclaw-)/u.test(name),
        ),
    ).toEqual([]);
  });

  it("rolls policy back when the live post-write verification fails", () => {
    const harness = createHarness();
    harness.policyReceiptFinalizeSpy.mockImplementationOnce(() => {
      throw new Error("live policy verification failed");
    });

    expect(() =>
      harness.shieldsDown("openclaw", {
        timeout: "5m",
        reason: "verification coverage",
        throwOnError: true,
      }),
    ).toThrow("live policy verification failed");

    expect(harness.policySetBodies.map((body) => YAML.parse(body).network_policies)).toEqual([
      {},
      { test: {} },
    ]);
    expect(harness.auditSpy).not.toHaveBeenCalled();
  });

  it("stops before policy or configuration mutation when live policy cannot be read", () => {
    const harness = createHarness();
    harness.runCaptureSpy.mockImplementation(() => {
      throw new Error("gateway unavailable");
    });

    expect(() => harness.shieldsDown("openclaw", { throwOnError: true })).toThrow(
      "Cannot capture current policy",
    );
    expect(harness.policySetBodies).toEqual([]);
    expect(harness.getOpenClawPosture()).toBe("mutable");
  });

  it("stops before unlocking when OpenShell rejects the temporary relaxation", () => {
    const harness = createHarness({
      initialOpenClawPosture: "locked",
      run: (command) => ({
        status:
          Array.isArray(command) && command.includes("policy") && command.includes("set") ? 1 : 0,
      }),
    });

    expect(() => harness.shieldsDown("openclaw", { throwOnError: true })).toThrow(
      /Could not apply/,
    );
    expect(harness.getOpenClawPosture()).toBe("locked");
    expect(harness.isShieldsDown("openclaw")).toBe(false);
    expect(harness.auditSpy).not.toHaveBeenCalled();
  });
});

// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import YAML from "yaml";

import * as openshellRuntimeModule from "../../adapters/openshell/runtime";
import {
  pendingSandboxPolicyVerificationForBoundary,
  revalidateCreatedSandboxPolicyRegistration,
  verifiedSandboxPolicyBoundaryFromPendingCheckpoint,
  verifyCreatedApfInterceptorPolicyRegistration,
  verifyCreatedSandboxInitialPolicy,
  type CreatedSandboxPolicyVerificationDeps,
} from "./policy-verification";

const POLICY = "version: 1\nnetwork_policies:\n  github:\n    endpoints: []\n";
const NATIVE_GPU_POLICY = `version: 1
filesystem_policy:
  include_workdir: true
  read_only:
    - /usr
    - /lib
    - /etc
    - /app
    - /var/log
    - /dev/urandom
  read_write:
    - /tmp
network_policies:
  github:
    endpoints: []
`;
const ENRICHED_NATIVE_GPU_POLICY = NATIVE_GPU_POLICY.replace(
  "  read_write:\n    - /tmp\n",
  "  read_write:\n    - /tmp\n    - /proc\n    - /dev/nvidiactl\n    - /dev/nvidia0\n",
);
const PROXY_ONLY_NATIVE_GPU_POLICY = NATIVE_GPU_POLICY.replace(
  "    - /dev/urandom\n",
  "    - /dev/urandom\n    - /proc\n",
);
const COMPATIBILITY_GPU_POLICY = NATIVE_GPU_POLICY.replace(
  "  read_write:\n    - /tmp\n",
  "  read_write:\n    - /tmp\n    - /proc\n",
);
const ENRICHED_COMPATIBILITY_GPU_POLICY = COMPATIBILITY_GPU_POLICY.replace(
  "    - /proc\n",
  "    - /proc\n    - /dev/nvidiactl\n    - /dev/nvidia0\n",
);
const INPUT = {
  sandboxName: "alpha",
  gatewayName: "nemoclaw",
  gatewayPort: 8080,
  lifecycleGeneration: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  lifecycleLiveIdentityFingerprint: "b".repeat(64),
  policySourcePath: "/private/policy.yaml",
  route: "none" as const,
};

function capture(stdout: string) {
  return { status: 0, output: stdout, stdout, stderr: "" };
}

function gatewayInfo() {
  return capture("Gateway endpoint: http://127.0.0.1:8080\n");
}

function metadata(
  options: {
    hash?: string;
    version?: number;
    source?: "sandbox" | "global";
    policy?: Record<string, unknown>;
  } = {},
) {
  return capture(
    JSON.stringify({
      scope: "sandbox",
      sandbox: "alpha",
      status: "effective",
      policy_source: options.source ?? "sandbox",
      active_version: options.version ?? 4,
      hash: options.hash ?? "sha256:effective",
      policy:
        options.policy ??
        ({ version: 1, network_policies: { github: { endpoints: [] } } } as const),
    }),
  );
}

function deps(): CreatedSandboxPolicyVerificationDeps {
  return {
    readFile: vi.fn(() => POLICY) as never,
    inspectPolicyReadiness: vi.fn(() => ({ state: "ready" as const })),
    sleep: vi.fn(),
  };
}

describe("created sandbox live policy verification", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("round-trips only the bounded incomplete-create identity checkpoint", () => {
    const boundary = {
      ...INPUT,
      createAttemptNonce: "c".repeat(62),
      registration: {
        policyIdentity: { hash: "sha256:effective", activeVersion: 4 },
      },
    };

    const checkpoint = pendingSandboxPolicyVerificationForBoundary(boundary);
    expect(checkpoint).not.toHaveProperty("policyAuthority");
    expect(checkpoint).not.toHaveProperty("policyCreationReceipt");
    expect(checkpoint.createAttemptNonce).toBe("c".repeat(62));
    expect(verifiedSandboxPolicyBoundaryFromPendingCheckpoint(checkpoint)).toEqual({
      ...boundary,
      policySourcePath: undefined,
    });
  });

  it("verifies the exact live base policy supplied by this create transaction", () => {
    vi.spyOn(openshellRuntimeModule, "captureResolvedOpenshell")
      .mockReturnValueOnce(gatewayInfo())
      .mockReturnValueOnce(metadata())
      .mockReturnValueOnce(metadata())
      .mockReturnValueOnce(capture(POLICY));

    expect(verifyCreatedSandboxInitialPolicy(INPUT, deps())).toEqual({
      policyIdentity: { hash: "sha256:effective", activeVersion: 4 },
    });
  });

  it.each([
    {
      route: "native" as const,
      requiredPolicy: NATIVE_GPU_POLICY,
      livePolicy: ENRICHED_NATIVE_GPU_POLICY,
    },
    {
      route: "native" as const,
      requiredPolicy: NATIVE_GPU_POLICY,
      livePolicy: PROXY_ONLY_NATIVE_GPU_POLICY,
    },
    {
      route: "compatibility" as const,
      requiredPolicy: COMPATIBILITY_GPU_POLICY,
      livePolicy: ENRICHED_COMPATIBILITY_GPU_POLICY,
    },
  ])(
    "accepts the reviewed $route GPU enrichment during live create verification (#10509)",
    ({ route, requiredPolicy, livePolicy }) => {
      const liveDocument = YAML.parse(livePolicy) as Record<string, unknown>;
      vi.spyOn(openshellRuntimeModule, "captureResolvedOpenshell")
        .mockReturnValueOnce(gatewayInfo())
        .mockReturnValueOnce(metadata({ policy: liveDocument }))
        .mockReturnValueOnce(metadata({ policy: liveDocument }))
        .mockReturnValueOnce(capture(livePolicy));

      expect(
        verifyCreatedSandboxInitialPolicy(
          { ...INPUT, route },
          { ...deps(), readFile: vi.fn(() => requiredPolicy) as never },
        ),
      ).toEqual({
        policyIdentity: { hash: "sha256:effective", activeVersion: 4 },
      });
    },
  );

  it("rejects an arbitrary filesystem addition during GPU create verification (#10509)", () => {
    const livePolicy = ENRICHED_COMPATIBILITY_GPU_POLICY.replace("/dev/nvidia0", "/home");
    const liveDocument = YAML.parse(livePolicy) as Record<string, unknown>;
    vi.spyOn(openshellRuntimeModule, "captureResolvedOpenshell")
      .mockReturnValueOnce(gatewayInfo())
      .mockReturnValueOnce(metadata({ policy: liveDocument }))
      .mockReturnValueOnce(metadata({ policy: liveDocument }))
      .mockReturnValueOnce(capture(livePolicy));

    expect(() =>
      verifyCreatedSandboxInitialPolicy(
        { ...INPUT, route: "compatibility" },
        { ...deps(), readFile: vi.fn(() => COMPATIBILITY_GPU_POLICY) as never },
      ),
    ).toThrow(/filesystem_policy|live base policy does not match/u);
  });

  it("accepts an APF-selected live policy when it contains the required policy", () => {
    vi.spyOn(openshellRuntimeModule, "captureResolvedOpenshell")
      .mockReturnValueOnce(gatewayInfo())
      .mockReturnValueOnce(metadata({ source: "global" }))
      .mockReturnValueOnce(metadata({ source: "global" }));

    expect(verifyCreatedApfInterceptorPolicyRegistration(INPUT, deps())).toEqual({
      policyIdentity: { hash: "sha256:effective", activeVersion: 4 },
    });
  });

  it("revalidates current live requirements without treating an old hash as authority", () => {
    vi.spyOn(openshellRuntimeModule, "captureResolvedOpenshell")
      .mockReturnValueOnce(gatewayInfo())
      .mockReturnValueOnce(metadata({ hash: "sha256:host-change", version: 9, source: "global" }))
      .mockReturnValueOnce(metadata({ hash: "sha256:host-change", version: 9, source: "global" }));

    expect(
      revalidateCreatedSandboxPolicyRegistration(
        {
          ...INPUT,
          registration: {
            policyIdentity: { hash: "sha256:original", activeVersion: 4 },
          },
        },
        deps(),
      ),
    ).toEqual({ policyIdentity: { hash: "sha256:host-change", activeVersion: 9 } });
  });

  it("rejects a current live policy that is missing a required rule", () => {
    vi.spyOn(openshellRuntimeModule, "captureResolvedOpenshell")
      .mockReturnValueOnce(gatewayInfo())
      .mockReturnValueOnce(metadata({ policy: { version: 1, network_policies: {} } }));

    expect(() =>
      revalidateCreatedSandboxPolicyRegistration(
        {
          ...INPUT,
          registration: {
            policyIdentity: { hash: "sha256:original", activeVersion: 4 },
          },
        },
        deps(),
      ),
    ).toThrow(/missing entries "github"/u);
  });
});

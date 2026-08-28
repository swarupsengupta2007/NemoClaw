// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import YAML from "yaml";

import {
  hasManagedMcpPolicyClaims,
  inspectExactManagedMcpPolicies,
  inspectProvableManagedMcpPoliciesForDeadline,
  inspectRecordedManagedMcpPolicies,
  type ExactManagedMcpPolicy,
} from "../actions/sandbox/mcp-bridge-policy";
import {
  buildMcpBridgePolicyKey,
  buildMcpBridgePolicyName,
  buildMcpBridgePolicyYaml,
} from "../actions/sandbox/mcp-bridge-policy-render";
import type { McpBridgeEntry, SandboxEntry } from "../state/registry";
import {
  composeDeadlineManagedMcpPolicies,
  composeManagedMcpPolicies,
} from "./mcp-policy-transition";

function bridge(server: string, address = "8.8.8.8"): McpBridgeEntry {
  return {
    server,
    agent: "hermes",
    adapter: "hermes-config",
    url: `https://${server}.example.com/mcp`,
    env: ["MCP_SECRET"],
    allowedIps: [address],
    providerName: `sandbox-mcp-${server}`,
    providerId: `provider-${server}`,
    policyName: buildMcpBridgePolicyName(server),
    addedAt: "2026-08-27T00:00:00.000Z",
  };
}

function sandbox(...bridges: McpBridgeEntry[]): SandboxEntry {
  return {
    name: "alpha",
    agent: "hermes",
    mcp: {
      bridges: Object.fromEntries(bridges.map((entry) => [entry.server, entry])),
    },
  };
}

function policyEntry(entry: McpBridgeEntry): unknown {
  return YAML.parse(
    buildMcpBridgePolicyYaml(
      entry.server,
      entry.url,
      "hermes-config",
      { addresses: entry.allowedIps ?? [] },
      entry.providerName ?? "",
    ),
  ).network_policies[buildMcpBridgePolicyKey(entry.server)];
}

function livePolicy(entries: McpBridgeEntry[], extra: Record<string, unknown> = {}): string {
  return YAML.stringify({
    version: 1,
    network_policies: {
      ...extra,
      ...Object.fromEntries(
        entries.map((entry) => [buildMcpBridgePolicyKey(entry.server), policyEntry(entry)]),
      ),
    },
  });
}

describe("managed MCP policy is derived from resource intent and live OpenShell state", () => {
  it("regenerates recorded policy from a committed bridge without a policy copy", () => {
    const alpha = bridge("alpha");

    expect(
      inspectRecordedManagedMcpPolicies("alpha", {
        getSandbox: () => sandbox(alpha),
      }),
    ).toEqual([
      {
        key: "mcp_bridge_alpha",
        networkPolicy: policyEntry(alpha),
        policyName: "mcp-bridge-alpha",
        server: "alpha",
      },
    ]);
  });

  it("accepts an exact live rule and ignores unrelated live entries", () => {
    const alpha = bridge("alpha");

    expect(
      inspectExactManagedMcpPolicies(
        "alpha",
        livePolicy([alpha], {
          operator_added: {
            endpoints: [{ host: "operator.example.com", port: 443 }],
          },
        }),
        { getSandbox: () => sandbox(alpha) },
      ),
    ).toHaveLength(1);
  });

  it("rejects drift, absence, and unclassified reserved keys", () => {
    const alpha = bridge("alpha");
    const drifted = YAML.parse(livePolicy([alpha]));
    drifted.network_policies.mcp_bridge_alpha.endpoints[0].port = 8443;

    expect(() =>
      inspectExactManagedMcpPolicies("alpha", YAML.stringify(drifted), {
        getSandbox: () => sandbox(alpha),
      }),
    ).toThrow(/drifted/);
    expect(() =>
      inspectExactManagedMcpPolicies("alpha", livePolicy([]), {
        getSandbox: () => sandbox(alpha),
      }),
    ).toThrow(/absent/);
    expect(() =>
      inspectExactManagedMcpPolicies("alpha", livePolicy([], { mcp_bridge_unowned: {} }), {
        getSandbox: () => ({ name: "alpha" }),
      }),
    ).toThrow(/no committed managed bridge ownership/);
  });

  it("rejects an incomplete bridge lifecycle", () => {
    const alpha = { ...bridge("alpha"), addState: "prepared" as const };

    expect(() =>
      inspectRecordedManagedMcpPolicies("alpha", {
        getSandbox: () => sandbox(alpha),
      }),
    ).toThrow(/incomplete/);
  });

  it("fails closed on invalid durable address pins", () => {
    const alpha = { ...bridge("alpha"), allowedIps: ["8.8.8.8", "8.8.8.8"] };

    expect(() =>
      inspectRecordedManagedMcpPolicies("alpha", {
        getSandbox: () => sandbox(alpha),
      }),
    ).toThrow(/invalid recorded address pins/);
  });

  it("deadline inspection keeps exact bridges and reports drifted bridges", () => {
    const alpha = bridge("alpha");
    const beta = bridge("beta", "9.9.9.9");
    const live = YAML.parse(livePolicy([alpha, beta]));
    live.network_policies.mcp_bridge_beta.endpoints[0].port = 8443;

    const result = inspectProvableManagedMcpPoliciesForDeadline("alpha", YAML.stringify(live), {
      getSandbox: () => sandbox(alpha, beta),
    });

    expect(result.policies.map(({ server }) => server)).toEqual(["alpha"]);
    expect(result.omissions).toEqual([
      expect.objectContaining({
        server: "beta",
        key: "mcp_bridge_beta",
        reason: expect.stringContaining("drifted"),
      }),
    ]);
  });

  it("reports bridge lifecycle state as a managed policy claim", () => {
    const alpha = bridge("alpha");

    expect(hasManagedMcpPolicyClaims("alpha", { getSandbox: () => sandbox(alpha) })).toBe(true);
    expect(
      hasManagedMcpPolicyClaims("alpha", {
        getSandbox: () => ({ name: "alpha" }),
      }),
    ).toBe(false);
  });
});

describe("managed MCP composition used while creating the Shields relaxed policy", () => {
  const exact = (server: string): ExactManagedMcpPolicy => {
    const entry = bridge(server);
    return {
      key: buildMcpBridgePolicyKey(server),
      networkPolicy: policyEntry(entry),
      policyName: buildMcpBridgePolicyName(server),
      server,
    };
  };

  it("replaces only snapshot-owned MCP keys and preserves unrelated policy", () => {
    const target = YAML.stringify({
      version: 1,
      network_policies: {
        restrictive: {},
        mcp_bridge_old: {},
      },
    });
    const composed = YAML.parse(
      composeManagedMcpPolicies(target, [exact("current")], ["mcp_bridge_old"]),
    );

    expect(composed.network_policies).toEqual({
      restrictive: {},
      mcp_bridge_current: exact("current").networkPolicy,
    });
  });

  it("deadline composition strips unclassified reserved keys", () => {
    const target = YAML.stringify({
      version: 1,
      network_policies: {
        restrictive: {},
        mcp_bridge_unclassified: {},
      },
    });
    const result = composeDeadlineManagedMcpPolicies(target, [], []);

    expect(YAML.parse(result.yaml).network_policies).toEqual({
      restrictive: {},
    });
    expect(result.omissions).toEqual([expect.objectContaining({ key: "mcp_bridge_unclassified" })]);
  });
});

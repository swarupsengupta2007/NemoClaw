// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import YAML from "yaml";

import * as policies from "../../policy";
import { replayTrustedPrivateEndpoint } from "../../security/trusted-private-endpoint";
import type { McpBridgeEntry } from "../../state/registry";
import * as registry from "../../state/registry";
import {
  buildMcpBridgePolicyKey,
  buildMcpBridgePolicyName,
  buildMcpBridgePolicyYaml,
  MCP_BRIDGE_ALLOWED_METHODS,
} from "./mcp-bridge-policy-render";
import {
  applyGeneratedPolicy,
  assertGeneratedPolicyExactReadOnly,
  assertGeneratedPolicyMutationSafe,
  removeGeneratedPolicy,
} from "./mcp-bridge-policy";

function bridge(overrides: Partial<McpBridgeEntry> = {}): McpBridgeEntry {
  return {
    server: "github",
    agent: "openclaw",
    adapter: "mcporter",
    url: "https://api.githubcopilot.com/mcp",
    env: ["GITHUB_MCP_TOKEN"],
    allowedIps: ["8.8.8.8"],
    providerName: "alpha-mcp-github-0123456789abcdef",
    policyName: "mcp-bridge-github",
    addedAt: "2026-08-27T00:00:00.000Z",
    ...overrides,
  };
}

function commit(entry: McpBridgeEntry): void {
  vi.spyOn(registry, "getSandbox").mockReturnValue({
    name: "alpha",
    agent: entry.agent,
    mcp: { bridges: { [entry.server]: entry } },
  });
}

describe("MCP OpenShell policy", () => {
  afterEach(() => vi.restoreAllMocks());

  it("refuses a generated policy without exact address pins", () => {
    expect(() => applyGeneratedPolicy("alpha", bridge(), { addresses: [] })).toThrow(
      /without exact address pins/,
    );
  });

  it("applies a scoped generated rule and verifies the live result", () => {
    const entry = bridge();
    vi.spyOn(policies, "getPresetContentGatewayState")
      .mockReturnValueOnce("absent")
      .mockReturnValueOnce("match");
    const apply = vi.spyOn(policies, "applyPresetContent").mockReturnValue(true);

    applyGeneratedPolicy("alpha", entry, { addresses: ["8.8.8.8"] });

    expect(apply).toHaveBeenCalledWith(
      "alpha",
      entry.policyName,
      expect.stringContaining("mcp_bridge_github"),
      { expectedExistingNetworkPolicyContent: null, nonFatal: true },
    );
  });

  it("does not replace a drifted live rule", () => {
    vi.spyOn(policies, "getPresetContentGatewayState").mockReturnValue("drift");
    const apply = vi.spyOn(policies, "applyPresetContent");

    expect(() => applyGeneratedPolicy("alpha", bridge(), { addresses: ["8.8.8.8"] })).toThrow(
      /drifted/,
    );
    expect(apply).not.toHaveBeenCalled();
  });

  it("removes only the exact live rule and verifies absence", () => {
    const entry = bridge();
    vi.spyOn(policies, "getPresetContentGatewayState")
      .mockReturnValueOnce("match")
      .mockReturnValueOnce("absent");
    const remove = vi.spyOn(policies, "removePolicyContent").mockReturnValue(true);

    removeGeneratedPolicy("alpha", entry);

    expect(remove).toHaveBeenCalledWith(
      "alpha",
      entry.policyName,
      expect.stringContaining("mcp_bridge_github"),
      { nonFatal: true },
    );
  });

  it("refuses to remove a changed host rule", () => {
    vi.spyOn(policies, "getPresetContentGatewayState").mockReturnValue("drift");
    const remove = vi.spyOn(policies, "removePolicyContent");

    expect(() => removeGeneratedPolicy("alpha", bridge())).toThrow(/drifted/);
    expect(remove).not.toHaveBeenCalled();
  });

  it("derives canonical ownership from committed bridge intent and live policy", () => {
    const entry = bridge();
    commit(entry);
    vi.spyOn(policies, "getPresetContentGatewayState").mockReturnValue("match");

    const record = assertGeneratedPolicyExactReadOnly("alpha", entry, "mcporter", {
      addresses: ["8.8.8.8"],
    });

    expect(record).toMatchObject({
      name: "mcp-bridge-github",
      sourcePath: "generated:nemoclaw-mcp-bridge",
    });
    expect(record.content).toContain("mcp_bridge_github");
    expect(() => assertGeneratedPolicyMutationSafe("alpha", entry)).not.toThrow();
  });

  it("rejects absent, incomplete, or non-canonical bridge intent", () => {
    vi.spyOn(registry, "getSandbox").mockReturnValue({ name: "alpha" });
    expect(() => assertGeneratedPolicyMutationSafe("alpha", bridge())).toThrow(
      /no matching committed bridge definition/,
    );

    vi.restoreAllMocks();
    const incomplete = bridge({ addState: "prepared" });
    commit(incomplete);
    expect(() =>
      assertGeneratedPolicyExactReadOnly("alpha", incomplete, "mcporter", {
        addresses: ["8.8.8.8"],
      }),
    ).toThrow(/ownership is not canonical/);
  });

  it("requires host-bound capability for a trusted private endpoint", () => {
    const entry = bridge({
      server: "internal",
      url: "https://mcp.corp.internal/mcp",
      trustedPrivateHost: "mcp.corp.internal",
      allowedIps: ["10.20.30.40"],
      policyName: buildMcpBridgePolicyName("internal"),
    });
    expect(() =>
      applyGeneratedPolicy("alpha", entry, {
        addresses: ["10.20.30.40"],
        trustedPrivateHost: "mcp.corp.internal",
      }),
    ).toThrow(/no provenance-checked capability/);

    const trusted = replayTrustedPrivateEndpoint("mcp.corp.internal", ["10.20.30.40"], {
      requireAllPrivate: true,
    });
    vi.spyOn(policies, "getPresetContentGatewayState").mockReturnValue("match");
    expect(() =>
      applyGeneratedPolicy("alpha", entry, {
        addresses: ["10.20.30.40"],
        trustedPrivateHost: trusted.host,
        trustedPrivateCapability: trusted.trustedPrivateCapability,
      }),
    ).not.toThrow();
  });

  it("renders the current OpenShell MCP method and credential surface", () => {
    const content = buildMcpBridgePolicyYaml(
      "GitHub_Server",
      "https://api.githubcopilot.com/mcp",
      "mcporter",
      { addresses: ["2606:4700:4700::1111", "8.8.8.8"] },
      "alpha-mcp-bound-provider",
    );
    const policy = YAML.parse(content) as {
      network_policies: Record<
        string,
        {
          endpoints: Array<{
            host: string;
            allowed_ips: string[];
            rules: Array<{ allow: { method: string } }>;
          }>;
        }
      >;
    };
    const key = buildMcpBridgePolicyKey("GitHub_Server");

    expect(policy.network_policies[key]?.endpoints[0]).toMatchObject({
      host: "api.githubcopilot.com",
      allowed_ips: ["2606:4700:4700::1111", "8.8.8.8"],
    });
    expect(policy.network_policies[key]?.endpoints[0]?.rules).toEqual(
      MCP_BRIDGE_ALLOWED_METHODS.map((method) => ({ allow: { method } })),
    );
    expect(content).toContain("alpha-mcp-bound-provider");
  });

  it.each(["", " provider "])(
    "rejects the invalid credential provider name %j",
    (providerName) => {
      expect(() =>
        buildMcpBridgePolicyYaml(
          "github",
          "https://api.githubcopilot.com/mcp",
          "mcporter",
          { addresses: ["8.8.8.8"] },
          providerName,
        ),
      ).toThrow(/requires an exact provider name/);
    },
  );
});

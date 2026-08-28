// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(".", () => ({
  getCustomPresetContent: vi.fn(),
  getGatewayPresets: vi.fn(),
  getPresetEndpoints: vi.fn(),
  isAgentBasePreset: vi.fn(),
  listCustomPresets: vi.fn(),
  listPresets: vi.fn(),
  loadPresetForSandbox: vi.fn(),
}));

import * as policies from ".";
import { buildPolicyContext, renderPolicyContextMarkdown } from "./context-builder";

const SANDBOX = "alpha";
const SLACK = `preset:
  name: slack
  description: Slack API access
network_policies:
  slack:
    endpoints:
      - host: api.slack.com
        port: 443
`;
const CUSTOM = `network_policies:
  nemoclaw_custom.internal-tools.0:
    endpoints:
      - host: public.example.com
        port: 443
      - host: 127.0.0.1
        port: 443
`;

describe("live policy context", () => {
  beforeEach(() => {
    vi.mocked(policies.getGatewayPresets).mockReset();
    vi.mocked(policies.getGatewayPresets).mockReturnValue(["slack"]);
    vi.mocked(policies.listPresets).mockReset();
    vi.mocked(policies.listPresets).mockReturnValue([
      { file: "slack.yaml", name: "slack", description: "Slack API access" },
      { file: "github.yaml", name: "github", description: "GitHub API access" },
    ]);
    vi.mocked(policies.listCustomPresets).mockReset();
    vi.mocked(policies.listCustomPresets).mockReturnValue([]);
    vi.mocked(policies.loadPresetForSandbox).mockReset();
    vi.mocked(policies.loadPresetForSandbox).mockImplementation((_sandbox, name) =>
      name === "slack" ? SLACK : null,
    );
    vi.mocked(policies.getCustomPresetContent).mockReset();
    vi.mocked(policies.getCustomPresetContent).mockReturnValue(null);
    vi.mocked(policies.getPresetEndpoints).mockReset();
    vi.mocked(policies.getPresetEndpoints).mockImplementation((content) =>
      [...content.matchAll(/host:\s*(\S+)/gu)].map((match) => match[1]),
    );
    vi.mocked(policies.isAgentBasePreset).mockReset();
    vi.mocked(policies.isAgentBasePreset).mockReturnValue(false);
  });

  it("derives active and unapplied built-ins only from current OpenShell policy", () => {
    const context = buildPolicyContext(SANDBOX);

    expect(context.tier).toBeNull();
    expect(context.activePresets).toEqual([
      expect.objectContaining({
        name: "slack",
        verification: "verified",
        allowedHostCategories: ["api.slack.com"],
      }),
    ]);
    expect(context.knownUnappliedPresets.map(({ name }) => name)).toEqual(["github"]);
    expect(context.baselineExclusions).toEqual([]);
  });

  it("identifies a live built-in that comes from the agent base policy", () => {
    vi.mocked(policies.isAgentBasePreset).mockReturnValue(true);

    expect(buildPolicyContext(SANDBOX).activePresets[0]?.verification).toBe("agent-base");
  });

  it("derives custom identity and scope from namespaced live rule keys", () => {
    vi.mocked(policies.getGatewayPresets).mockReturnValue(["slack", "internal-tools"]);
    vi.mocked(policies.listCustomPresets).mockReturnValue([
      {
        file: "internal-tools.yaml",
        name: "internal-tools",
        description: "custom preset",
      },
    ]);
    vi.mocked(policies.getCustomPresetContent).mockReturnValue(CUSTOM);

    const custom = buildPolicyContext(SANDBOX).activePresets.find(
      ({ name }) => name === "internal-tools",
    );
    expect(custom).toMatchObject({
      source: "custom",
      verification: "verified",
      allowedHostCategories: ["public.example.com"],
    });
    expect(custom?.redactedHostCount).toBe(1);
  });

  it("reports unavailable live policy without reviving registry state", () => {
    vi.mocked(policies.getGatewayPresets).mockReturnValue(null);

    const context = buildPolicyContext(SANDBOX);
    expect(context.activePresets).toEqual([]);
    expect(context.knownUnappliedPresets.map(({ name }) => name)).toEqual(["github", "slack"]);
    expect(context.approvalPath.add).toContain("policy add");
  });

  it("renders the live result and no durable tier or exclusion claims", () => {
    const markdown = renderPolicyContextMarkdown(buildPolicyContext(SANDBOX));

    expect(markdown).toContain("`slack`");
    expect(markdown).toContain("api.slack.com");
    expect(markdown).toContain("status: verified");
    expect(markdown).toContain("- no tier recorded");
    expect(markdown).toContain("## Baseline exclusions\n- none");
    expect(markdown).toContain("status comes from current OpenShell policy");
  });
});

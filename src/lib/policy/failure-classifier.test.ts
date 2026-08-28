// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(".", () => ({
  getCustomPresetContent: vi.fn(() => null),
  getGatewayPresets: vi.fn(),
  getPresetEndpoints: vi.fn(),
  isAgentBasePreset: vi.fn(() => false),
  listCustomPresets: vi.fn(() => []),
  listPresets: vi.fn(),
  loadPresetForSandbox: vi.fn(),
}));

import * as policies from ".";
import { classifyAccessFailure } from "./failure-classifier";

const SANDBOX = "alpha";
const PRESETS: Record<string, string> = {
  slack: `preset:
  name: slack
network_policies:
  slack:
    endpoints:
      - host: api.slack.com
`,
  github: `preset:
  name: github
network_policies:
  github:
    endpoints:
      - host: api.github.com
`,
};

describe("classifyAccessFailure from live policy", () => {
  beforeEach(() => {
    vi.mocked(policies.listPresets).mockReturnValue([
      { file: "slack.yaml", name: "slack", description: "Slack API access" },
      { file: "github.yaml", name: "github", description: "GitHub API access" },
    ]);
    vi.mocked(policies.loadPresetForSandbox).mockImplementation(
      (_sandbox, name) => PRESETS[name] ?? null,
    );
    vi.mocked(policies.getPresetEndpoints).mockImplementation((content) =>
      [...content.matchAll(/host:\s*(\S+)/gu)].map((match) => match[1]),
    );
    vi.mocked(policies.getGatewayPresets).mockReturnValue(["slack"]);
  });

  it("returns high-confidence missing approval for a live allowed host with HTTP 401", () => {
    const result = classifyAccessFailure({
      sandboxName: SANDBOX,
      host: "api.slack.com",
      error: { status: 401 },
      gatewayPresets: ["slack"],
    });

    expect(result).toMatchObject({
      kind: "missing-approval",
      matchedPreset: "slack",
      confidence: "high",
    });
  });

  it("keeps HTTP 403 on a live allowed host ambiguous", () => {
    const result = classifyAccessFailure({
      sandboxName: SANDBOX,
      host: "api.slack.com",
      error: { status: 403 },
      gatewayPresets: ["slack"],
    });

    expect(result).toMatchObject({
      kind: "missing-approval",
      matchedPreset: "slack",
      confidence: "low",
    });
    expect(result.nextStep).toContain("openshell policy get");
  });

  it("suggests adding a known preset absent from live policy", () => {
    const result = classifyAccessFailure({
      sandboxName: SANDBOX,
      host: "api.github.com",
      error: { code: "EHOSTUNREACH" },
      gatewayPresets: ["slack"],
    });

    expect(result).toMatchObject({
      kind: "blocked-by-policy",
      matchedPreset: "github",
      confidence: "high",
    });
    expect(result.nextStep).toContain("policy add github");
  });

  it("matches a subdomain against a live preset host stem", () => {
    const result = classifyAccessFailure({
      sandboxName: SANDBOX,
      host: "edge.api.slack.com",
      error: { status: 401 },
      gatewayPresets: ["slack"],
    });

    expect(result.matchedPreset).toBe("slack");
  });

  it("classifies a network error on a live allowed host as upstream", () => {
    const result = classifyAccessFailure({
      sandboxName: SANDBOX,
      host: "api.slack.com",
      error: { code: "EHOSTUNREACH" },
      gatewayPresets: ["slack"],
    });

    expect(result).toMatchObject({
      kind: "unknown",
      matchedPreset: "slack",
      confidence: "high",
    });
    expect(result.reason).toContain("upstream");
  });

  it("does not revive active state when current OpenShell policy is unavailable", () => {
    const result = classifyAccessFailure({
      sandboxName: SANDBOX,
      host: "api.slack.com",
      error: { code: "EHOSTUNREACH" },
      gatewayPresets: null,
    });

    expect(result.kind).toBe("blocked-by-policy");
    expect(result.matchedPreset).toBe("slack");
    expect(result.nextStep).toContain("policy add slack");
  });

  it("returns unsupported before policy classification", () => {
    const result = classifyAccessFailure({
      sandboxName: SANDBOX,
      host: "api.slack.com",
      capability: { supported: false, reason: "messaging is unavailable" },
    });

    expect(result).toMatchObject({ kind: "unsupported", confidence: "high" });
    expect(result.reason).toContain("messaging is unavailable");
  });

  it("returns unknown for an unrecognized upstream failure", () => {
    const result = classifyAccessFailure({
      sandboxName: SANDBOX,
      host: "unknown.example",
      error: { code: "ECONNRESET", status: 500 },
      gatewayPresets: ["slack"],
    });

    expect(result.kind).toBe("unknown");
    expect(result.matchedPreset).toBeUndefined();
  });
});

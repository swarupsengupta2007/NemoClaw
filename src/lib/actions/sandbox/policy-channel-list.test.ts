// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

type PresetInfo = {
  name: string;
  description: string;
};

const moduleMocks = vi.hoisted(() => ({
  getSandbox: vi.fn<(sandboxName: string) => Record<string, unknown> | null>(),
  listPresets: vi.fn<(options?: { agent?: string | null }) => PresetInfo[]>(),
  listCustomPresets: vi.fn<(sandboxName: string) => PresetInfo[]>(),
  getGatewayPresets: vi.fn<(sandboxName: string) => string[] | null>(),
  isDockerRuntimeDown: vi.fn<(sandboxName: string) => boolean>(),
  printDockerRuntimeDownGuidance: vi.fn(),
}));

vi.mock("../../state/registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/registry")>()),
  getSandbox: moduleMocks.getSandbox,
}));

vi.mock("../../policy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../policy")>()),
  listPresets: moduleMocks.listPresets,
  listCustomPresets: moduleMocks.listCustomPresets,
  getGatewayPresets: moduleMocks.getGatewayPresets,
}));

vi.mock("./gateway-failure-classifier", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./gateway-failure-classifier")>()),
  isDockerRuntimeDown: moduleMocks.isDockerRuntimeDown,
  printDockerRuntimeDownGuidance: moduleMocks.printDockerRuntimeDownGuidance,
}));

import { listSandboxPolicies } from "./policy-channel";

const POLICY_PRESETS: PresetInfo[] = [
  { name: "npm", description: "npm and Yarn registry access" },
  { name: "pypi", description: "Python Package Index access" },
  { name: "discord", description: "Discord API access" },
  { name: "openclaw-pricing", description: "OpenClaw pricing lookup" },
  { name: "nous-web", description: "Nous Portal managed web search gateway" },
];

let logSpy: MockInstance;
let errSpy: MockInstance;

function printedText(): string {
  return [...logSpy.mock.calls, ...errSpy.mock.calls]
    .map((call) => call.map(String).join(" "))
    .join("\n");
}

function arrangeListing(gatewayNames: string[] | null, agent: string | null): void {
  moduleMocks.getSandbox.mockReturnValue({ name: "test-sandbox", agent });
  moduleMocks.getGatewayPresets.mockReturnValue(gatewayNames);
}

beforeEach(() => {
  vi.clearAllMocks();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  moduleMocks.listPresets.mockReturnValue(POLICY_PRESETS);
  moduleMocks.listCustomPresets.mockReturnValue([]);
  moduleMocks.isDockerRuntimeDown.mockReturnValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("listSandboxPolicies live OpenShell authority", () => {
  it("marks only presets present in the live policy as active", () => {
    arrangeListing(["npm", "pypi"], "openclaw");

    listSandboxPolicies("test-sandbox");

    const output = printedText();
    expect(output).toContain("● npm [user-added]");
    expect(output).toContain("● pypi [user-added]");
    expect(output).toMatch(/○ discord —/u);
  });

  it("ignores removed registry policy-shadow fields", () => {
    moduleMocks.getSandbox.mockReturnValue({
      name: "test-sandbox",
      agent: "openclaw",
      policyTier: "balanced",
      policies: ["npm"],
    });
    moduleMocks.getGatewayPresets.mockReturnValue([]);

    listSandboxPolicies("test-sandbox");

    expect(printedText()).toMatch(/○ npm —/u);
  });

  it("lists live custom presets as user-added", () => {
    arrangeListing(["internal-tools"], "openclaw");
    moduleMocks.listCustomPresets.mockReturnValue([
      { name: "internal-tools", description: "custom preset" },
    ]);

    listSandboxPolicies("test-sandbox");

    expect(printedText()).toContain("● internal-tools [user-added] — custom preset");
  });

  it("tags agent-owned presets from the sandbox agent", () => {
    arrangeListing(["openclaw-pricing"], "openclaw");

    listSandboxPolicies("test-sandbox");

    expect(printedText()).toContain("● openclaw-pricing [from openclaw agent]");
  });

  it.each([
    { agent: "hermes", preset: "openclaw-pricing", forbidden: "[from openclaw agent]" },
    { agent: "openclaw", preset: "nous-web", forbidden: "[from hermes agent]" },
  ])("does not infer another agent's provenance for $preset", ({ agent, preset, forbidden }) => {
    arrangeListing([preset], agent);

    listSandboxPolicies("test-sandbox");

    const output = printedText();
    expect(output).toContain(`● ${preset} [user-added]`);
    expect(output).not.toContain(forbidden);
  });

  it("asks the catalog for presets available to the sandbox agent", () => {
    arrangeListing([], "langchain-deepagents-code");
    moduleMocks.listPresets.mockImplementation((options) =>
      options?.agent === "langchain-deepagents-code"
        ? [
            { name: "npm", description: "npm and Yarn registry access" },
            { name: "pypi", description: "Python Package Index access" },
          ]
        : POLICY_PRESETS,
    );

    listSandboxPolicies("test-sandbox");

    expect(moduleMocks.listPresets).toHaveBeenCalledWith({ agent: "langchain-deepagents-code" });
    expect(printedText()).not.toContain("discord");
  });

  it("shows no applied state when the live policy is unreadable", () => {
    arrangeListing(null, "openclaw");

    listSandboxPolicies("test-sandbox");

    const output = printedText();
    expect(output).toMatch(/○ npm —/u);
    expect(output).toContain("Could not query the live OpenShell policy");
    expect(output).toContain("applied state unavailable");
  });

  it("uses Docker recovery guidance when the runtime is down", () => {
    arrangeListing(null, "openclaw");
    moduleMocks.isDockerRuntimeDown.mockReturnValue(true);

    listSandboxPolicies("test-sandbox");

    expect(moduleMocks.printDockerRuntimeDownGuidance).toHaveBeenCalledWith("test-sandbox", {
      writer: console.log,
      retryCommand: "policy-list",
    });
  });
});

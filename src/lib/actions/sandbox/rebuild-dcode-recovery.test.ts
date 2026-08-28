// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  configureDcodeSession,
  makeDcodeSandboxEntry,
} from "../../../../test/helpers/rebuild-dcode-flow-helpers";
import {
  createRebuildFlowHarness,
  installRebuildFlowTestHooks,
  makePreparedRecoveryManifest,
} from "../../../../test/helpers/rebuild-flow-dcode-harness";

describe("rebuildSandbox DCode flow: recovery", () => {
  installRebuildFlowTestHooks({ acceptThirdPartySoftware: true });

  it("recreates non-Ready DCode from a validated backup without requiring a live route (#6195)", async () => {
    const recoveryManifest = {
      ...makePreparedRecoveryManifest(),
      agentType: "langchain-deepagents-code",
      agentVersion: "0.1.12",
      dir: "/sandbox/.deepagents",
    };
    const harness = createRebuildFlowHarness({
      agentName: "langchain-deepagents-code",
      sandboxEntry: makeDcodeSandboxEntry(),
      sandboxInventory: {
        sandboxes: [{ name: "alpha", phase: "Error", readiness: "terminal" }],
      },
      preDeleteLatestManifest: recoveryManifest,
    });
    configureDcodeSession(harness);

    await expect(
      harness.rebuildSandbox("alpha", ["--yes"], {
        throwOnError: true,
        recoveryManifest,
      }),
    ).resolves.toBeUndefined();

    expect(harness.preflightDcodeRouteSpy).not.toHaveBeenCalled();
    expect(harness.prepareManagedDcodeRebuildImageSpy).toHaveBeenCalledOnce();
    expect(harness.backupSandboxStateSpy).not.toHaveBeenCalled();
    expect(harness.runOpenshellSpy).toHaveBeenCalledWith(
      ["sandbox", "delete", "-g", "nemoclaw", "alpha"],
      expect.objectContaining({ ignoreError: true }),
    );
    expect(harness.onboardSpy).toHaveBeenCalledOnce();
    expect(harness.restoreSandboxStateSpy).toHaveBeenCalledWith(
      "alpha",
      recoveryManifest.backupPath,
      { targetAgentType: "langchain-deepagents-code" },
    );
  });
  it("ignores legacy custom-policy registry mirrors during stale DCode recovery (#6195)", async () => {
    const livePolicyDocument = "version: 1\nnetwork_policies:\n  custom-egress: {}";
    const harness = createRebuildFlowHarness({
      agentName: "langchain-deepagents-code",
      livePolicyDocument,
      sandboxEntry: {
        ...makeDcodeSandboxEntry(),
        customPolicies: [{ name: "stale-registry-copy", content: "invalid" }],
        policyPresetsFinalized: true,
      },
      sandboxInventory: { sandboxes: [] },
      reconciledSandboxGatewayState: { state: "missing", output: "" },
    });
    configureDcodeSession(harness);

    await expect(
      harness.rebuildSandbox("alpha", ["--yes"], { throwOnError: true }),
    ).resolves.toBeUndefined();

    expect(harness.backupSandboxStateSpy).not.toHaveBeenCalled();
    expect(harness.applyPresetSpy).not.toHaveBeenCalled();
    expect(harness.applyPresetContentSpy).not.toHaveBeenCalled();
    expect(harness.setLivePolicyDocumentSpy).toHaveBeenCalledWith(
      "alpha",
      livePolicyDocument,
      expect.objectContaining({
        operation: "restore the captured rebuild policy",
      }),
    );
    expect(harness.registryUpdateSpy).toHaveBeenCalledWith("alpha", {
      agentVersion: "0.2.0",
    });
  });

  it("ignores legacy policy tier while restoring restricted DCode policy exactly", async () => {
    let policyTierSeenDuringOnboard: string | undefined;
    const livePolicyDocument = "version: 1\nnetwork_policies:\n  restricted-host-rule: {}";
    const harness = createRebuildFlowHarness({
      agentName: "langchain-deepagents-code",
      applyPreset: () => true,
      livePolicyDocument,
      dcodeRouteResults: [{ ok: true }, { ok: true }, { ok: true }, { ok: true }],
      gatewayPresets: ["observability-otlp-local"],
      sandboxEntry: {
        ...makeDcodeSandboxEntry(),
        observabilityEnabled: true,
        policies: ["npm", "observability-otlp-local"],
        policyPresetsFinalized: true,
        policyTier: " Restricted ",
      },
      onboard: () => {
        policyTierSeenDuringOnboard = process.env.NEMOCLAW_POLICY_TIER;
      },
    });
    configureDcodeSession(harness);
    harness.session.observabilityEnabled = true;

    await expect(
      harness.rebuildSandbox("alpha", ["--yes"], { throwOnError: true }),
    ).resolves.toBeUndefined();

    expect(policyTierSeenDuringOnboard).toBeUndefined();
    expect(harness.onboardSpy).toHaveBeenCalledWith(
      expect.objectContaining({ observabilityRequestedExplicitly: false }),
    );
    expect(harness.session.observabilityRequestedExplicitly).toBe(false);
    expect(harness.applyPresetSpy).not.toHaveBeenCalled();
    expect(harness.setLivePolicyDocumentSpy).toHaveBeenCalledWith(
      "alpha",
      livePolicyDocument,
      expect.objectContaining({
        operation: "restore the captured rebuild policy",
      }),
    );
    expect(harness.registryUpdateSpy).toHaveBeenCalledWith("alpha", {
      agentVersion: "0.2.0",
    });
  });

  it("does not synthesize an observability preset from legacy balanced-tier state", async () => {
    const harness = createRebuildFlowHarness({
      agentName: "langchain-deepagents-code",
      applyPreset: () => true,
      dcodeRouteResults: [{ ok: true }, { ok: true }, { ok: true }, { ok: true }],
      gatewayPresets: [],
      sandboxEntry: {
        ...makeDcodeSandboxEntry(),
        observabilityEnabled: true,
        policies: ["npm"],
        policyPresetsFinalized: true,
        policyTier: "balanced",
      },
    });
    configureDcodeSession(harness);
    harness.session.observabilityEnabled = true;

    await expect(
      harness.rebuildSandbox("alpha", ["--yes"], { throwOnError: true }),
    ).resolves.toBeUndefined();

    expect(harness.applyPresetSpy).not.toHaveBeenCalled();
    expect(harness.setLivePolicyDocumentSpy).toHaveBeenCalledOnce();
    expect(harness.registryUpdateSpy).toHaveBeenCalledWith("alpha", {
      agentVersion: "0.2.0",
    });
  });

  it.each([
    {
      label: "enables",
      flag: "--observability",
      before: false,
      expected: true,
      backupPresets: [] as string[],
      gatewayPresets: [] as string[],
    },
    {
      label: "disables",
      flag: "--no-observability",
      before: true,
      expected: false,
      backupPresets: ["observability-otlp-local"],
      gatewayPresets: ["observability-otlp-local"],
    },
  ])(
    "$label observability transactionally while preserving managed MCP state",
    async ({ flag, before, expected, backupPresets, gatewayPresets }) => {
      const mcpEntry = { server: "search", providerName: "mcp-search" };
      const harness = createRebuildFlowHarness({
        agentName: "langchain-deepagents-code",
        applyPreset: () => true,
        dcodeRouteResults: [{ ok: true }, { ok: true }, { ok: true }, { ok: true }],
        gatewayPresets,
        mcpPreparation: {
          entries: [mcpEntry],
          detachedProviderEntries: [mcpEntry],
          scrubbedAdapterEntries: [],
        },
        sandboxEntry: {
          ...makeDcodeSandboxEntry(),
          observabilityEnabled: before,
          policies: backupPresets,
          policyPresetsFinalized: true,
          policyTier: "balanced",
          mcp: {
            bridges: { search: mcpEntry },
            managedServerNames: ["search"],
          },
        },
      });
      configureDcodeSession(harness);
      harness.session.observabilityEnabled = before;

      await expect(
        harness.rebuildSandbox("alpha", ["--yes", flag], {
          throwOnError: true,
        }),
      ).resolves.toBeUndefined();

      expect(harness.onboardSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          observabilityEnabled: expected,
          observabilityRequestedExplicitly: true,
        }),
      );
      expect(harness.session.observabilityEnabled).toBe(expected);
      expect(harness.session.observabilityRequestedExplicitly).toBe(true);
      expect(harness.applyPresetSpy).not.toHaveBeenCalled();
      expect(harness.setLivePolicyDocumentSpy).toHaveBeenCalledOnce();
      expect(harness.restoreMcpBridgesAfterRebuildSpy).toHaveBeenCalledWith("alpha", [mcpEntry]);
      expect(harness.registryUpdateSpy).toHaveBeenCalledWith("alpha", {
        agentVersion: "0.2.0",
      });
    },
  );

  it("restores the captured live policy over policy changes made by inner onboard", async () => {
    const livePolicyDocument = "version: 1\nnetwork_policies:\n  host-policy: {}";
    const harness = createRebuildFlowHarness({
      agentName: "langchain-deepagents-code",
      applyPreset: () => true,
      livePolicyDocument,
      dcodeRouteResults: [{ ok: true }, { ok: true }, { ok: true }, { ok: true }],
      gatewayPresets: ["future-dcode-required"],
      sandboxEntry: {
        ...makeDcodeSandboxEntry(),
        policies: ["npm"],
        policyPresetsFinalized: true,
        policyTier: "balanced",
      },
    });
    configureDcodeSession(harness);

    await expect(
      harness.rebuildSandbox("alpha", ["--yes"], { throwOnError: true }),
    ).resolves.toBeUndefined();

    expect(harness.applyPresetSpy).not.toHaveBeenCalled();
    expect(harness.setLivePolicyDocumentSpy).toHaveBeenCalledWith(
      "alpha",
      livePolicyDocument,
      expect.objectContaining({
        operation: "restore the captured rebuild policy",
      }),
    );
    expect(harness.registryUpdateSpy).toHaveBeenCalledWith("alpha", {
      agentVersion: "0.2.0",
    });
  });

  it("never removes or persists DCode base-policy keys detected as broad presets", async () => {
    const harness = createRebuildFlowHarness({
      agentName: "langchain-deepagents-code",
      dcodeRouteResults: [{ ok: true }, { ok: true }, { ok: true }, { ok: true }],
      gatewayPresets: ["github", "pypi"],
      sandboxEntry: {
        ...makeDcodeSandboxEntry(),
        observabilityEnabled: false,
        policies: [],
        policyPresetsFinalized: true,
        policyTier: "balanced",
      },
    });
    configureDcodeSession(harness);
    harness.session.observabilityEnabled = false;

    await expect(
      harness.rebuildSandbox("alpha", ["--yes"], { throwOnError: true }),
    ).resolves.toBeUndefined();

    expect(harness.removePresetSpy).not.toHaveBeenCalled();
    expect(harness.applyPresetSpy).not.toHaveBeenCalled();
    expect(harness.registryUpdateSpy).toHaveBeenCalledWith("alpha", {
      agentVersion: "0.2.0",
    });
  });

  it("restores a host-owned observability policy without narrowing it", async () => {
    const livePolicyDocument =
      "version: 1\nnetwork_policies:\n  observability-otlp-local:\n    endpoints:\n      - host: collector.corp.example";
    const harness = createRebuildFlowHarness({
      agentName: "langchain-deepagents-code",
      livePolicyDocument,
      dcodeRouteResults: [{ ok: true }, { ok: true }, { ok: true }, { ok: true }],
      gatewayPresets: ["observability-otlp-local"],
      sandboxEntry: {
        ...makeDcodeSandboxEntry(),
        observabilityEnabled: false,
        policies: [],
        policyPresetsFinalized: true,
        policyTier: "balanced",
      },
    });
    configureDcodeSession(harness);
    harness.session.observabilityEnabled = false;

    await expect(
      harness.rebuildSandbox("alpha", ["--yes"], { throwOnError: true }),
    ).resolves.toBeUndefined();

    expect(harness.applyPresetContentSpy).not.toHaveBeenCalled();
    expect(harness.setLivePolicyDocumentSpy).toHaveBeenCalledWith(
      "alpha",
      livePolicyDocument,
      expect.objectContaining({
        operation: "restore the captured rebuild policy",
      }),
    );
    expect(harness.removePresetSpy).not.toHaveBeenCalled();
    expect(harness.registryUpdateSpy).toHaveBeenCalledWith("alpha", {
      agentVersion: "0.2.0",
    });
  });

  it("fails after recording recovery state when exact live-policy restore cannot be verified", async () => {
    const harness = createRebuildFlowHarness({
      agentName: "langchain-deepagents-code",
      applyPreset: () => true,
      dcodeRouteResults: [{ ok: true }, { ok: true }, { ok: true }, { ok: true }],
      gatewayPresets: ["observability-otlp-local"],
      sandboxEntry: {
        ...makeDcodeSandboxEntry(),
        observabilityEnabled: true,
        policies: ["npm", "observability-otlp-local"],
        policyPresetsFinalized: true,
        policyTier: "restricted",
      },
    });
    configureDcodeSession(harness);
    harness.session.observabilityEnabled = true;
    harness.setLivePolicyDocumentSpy.mockReturnValue(false);

    await expect(
      harness.rebuildSandbox("alpha", ["--yes"], { throwOnError: true }),
    ).rejects.toThrow("Rebuild completed with unverified live policy reconciliation for 'alpha'.");

    expect(harness.registryUpdateSpy).toHaveBeenCalledWith("alpha", {
      agentVersion: "0.2.0",
    });
    expect(harness.relockSpy).toHaveBeenCalled();
  });

  it("rejects an observability override for a non-DCode sandbox before mutation", async () => {
    const harness = createRebuildFlowHarness({
      agentName: "openclaw",
      sandboxEntry: {
        name: "alpha",
        agent: "openclaw",
        nemoclawVersion: "0.1.0",
      },
    });

    await expect(
      harness.rebuildSandbox("alpha", ["--yes", "--observability"], {
        throwOnError: true,
      }),
    ).rejects.toThrow("Unsupported rebuild observability override");

    expect(harness.openShieldsSpy).not.toHaveBeenCalled();
    expect(harness.backupSandboxStateSpy).not.toHaveBeenCalled();
    expect(harness.onboardSpy).not.toHaveBeenCalled();
  });
});

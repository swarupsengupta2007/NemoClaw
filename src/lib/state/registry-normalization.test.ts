// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  normalizePendingSandboxCreateVerification,
  normalizeSandboxEntry,
  retainedDefaultSandbox,
} from "./registry-normalization";
import type { PendingSandboxCreateVerification, SandboxEntry } from "./registry/types";

const originalHome = process.env.HOME;
const temporaryHomes: string[] = [];

async function loadRegistryDocument(document: unknown) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-registry-normalization-"));
  temporaryHomes.push(home);
  const configDir = path.join(home, ".nemoclaw");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "sandboxes.json"), JSON.stringify(document), {
    mode: 0o600,
  });
  process.env.HOME = home;
  vi.resetModules();
  return import("./registry");
}

afterEach(() => {
  process.env.HOME = originalHome;
  vi.resetModules();
  for (const home of temporaryHomes.splice(0)) {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

const checkpoint: PendingSandboxCreateVerification = {
  schemaVersion: 1,
  state: "verified-create",
  gatewayName: "nemoclaw",
  gatewayPort: 8080,
  sandboxName: "alpha",
  lifecycleGeneration: "123e4567-e89b-42d3-a456-426614174983",
  sandboxIdentityFingerprint: "a".repeat(64),
  createAttemptNonce: "c".repeat(62),
  route: "none",
  policyHash: "sha256:observed-live-policy",
  policyVersion: 7,
};

describe("sandbox registry normalization", () => {
  it.each([null, [], 42, "invalid"])(
    "treats a non-object top-level document as empty: %j",
    async (document) => {
      const registry = await loadRegistryDocument(document);
      expect(registry.listSandboxes()).toEqual({
        sandboxes: [],
        defaultSandbox: null,
      });
    },
    15_000,
  );

  it("drops malformed containers and entries without usable names", async () => {
    const malformedContainer = await loadRegistryDocument({
      defaultSandbox: "alpha",
      sandboxes: [],
    });
    expect(malformedContainer.listSandboxes()).toEqual({
      sandboxes: [],
      defaultSandbox: "alpha",
    });

    const malformedEntries = await loadRegistryDocument({
      defaultSandbox: "alpha",
      sandboxes: {
        alpha: { model: "missing-name" },
        beta: { name: "different-key" },
        valid: { name: "valid", model: "kept" },
      },
    });
    expect(malformedEntries.listSandboxes()).toEqual({
      sandboxes: [expect.objectContaining({ name: "valid", model: "kept" })],
      defaultSandbox: "alpha",
    });
  });

  it("drops every legacy policy shadow without validating or replaying it", async () => {
    const registry = await loadRegistryDocument({
      defaultSandbox: "alpha",
      sandboxes: {
        alpha: {
          name: "alpha",
          model: "kept",
          policies: "malformed",
          customPolicies: [{ content: "must not survive" }],
          baselineExclusions: { malformed: true },
          baselineExclusionTransition: "malformed",
          policyPresetsFinalized: true,
          policyTier: "strict",
          policyAuthority: "externally-managed",
          policyCreationReceipt: { malformed: true },
          pendingPolicyVerification: { malformed: true },
        },
      },
    });

    const entry = registry.getSandbox("alpha");
    expect(entry).toEqual({ name: "alpha", model: "kept" });
    registry.save(registry.load());
    const persisted = JSON.parse(
      fs.readFileSync(path.join(process.env.HOME!, ".nemoclaw", "sandboxes.json"), "utf8"),
    ) as { sandboxes: Record<string, Record<string, unknown>> };
    expect(persisted.sandboxes.alpha).toEqual({ name: "alpha", model: "kept" });
  });

  it("normal registry mutations continue to omit removed policy fields", async () => {
    const registry = await loadRegistryDocument({
      defaultSandbox: null,
      sandboxes: {},
    });
    registry.registerSandbox({
      name: "alpha",
      agent: "hermes",
      gatewayName: "nemoclaw",
    });
    expect(registry.updateSandbox("alpha", { model: "updated" })).toBe(true);
    expect(registry.getSandbox("alpha")).toEqual(
      expect.objectContaining({
        name: "alpha",
        agent: "hermes",
        gatewayName: "nemoclaw",
        model: "updated",
      }),
    );
    const entry = registry.getSandbox("alpha") as unknown as Record<string, unknown>;
    expect(Object.keys(entry)).not.toEqual(
      expect.arrayContaining([
        "policyAuthority",
        "policyCreationReceipt",
        "pendingPolicyVerification",
        "policies",
        "customPolicies",
        "baselineExclusions",
        "baselineExclusionTransition",
        "policyTier",
        "policyPresetsFinalized",
      ]),
    );
  });

  it("round-trips the bounded checkpoint only while create is incomplete", async () => {
    const registry = await loadRegistryDocument({
      defaultSandbox: null,
      sandboxes: {
        alpha: {
          name: "alpha",
          pendingRouteReservation: true,
          reservationSessionId: "session",
          pendingCreateVerification: checkpoint,
        },
      },
    });
    expect(registry.getSandbox("alpha")?.pendingCreateVerification).toEqual(checkpoint);
  });

  it("fails closed for a malformed active create checkpoint", () => {
    expect(() =>
      normalizePendingSandboxCreateVerification({
        ...checkpoint,
        policyVersion: 0,
      }),
    ).toThrow(/invalid pending create verification/);
  });

  it("fails closed for a malformed create-attempt nonce", () => {
    expect(() =>
      normalizePendingSandboxCreateVerification({
        ...checkpoint,
        createAttemptNonce: "not-a-nonce",
      }),
    ).toThrow(/invalid pending create verification/);
  });

  it("normalizes an entry directly and preserves non-policy resource state", () => {
    const legacy = {
      name: "alpha",
      agent: "openclaw",
      mcp: { bridges: {} },
      policies: ["weather"],
      customPolicies: [{ name: "legacy", content: "network_policies: {}" }],
      policyAuthority: "nemoclaw-managed",
      policyCreationReceipt: { policyHash: "stale" },
    } as unknown as SandboxEntry;

    expect(normalizeSandboxEntry(legacy)).toEqual({
      name: "alpha",
      agent: "openclaw",
      mcp: { bridges: {} },
    });
  });

  it("retains a default only for a committed sandbox row", () => {
    expect(
      retainedDefaultSandbox("alpha", {
        alpha: { name: "alpha" },
      }),
    ).toBe("alpha");
    expect(
      retainedDefaultSandbox("alpha", {
        alpha: { name: "alpha", pendingRouteReservation: true },
      }),
    ).toBeNull();
    expect(retainedDefaultSandbox("missing", {})).toBeNull();
  });
});

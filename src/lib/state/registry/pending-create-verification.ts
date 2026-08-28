// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { PendingSandboxCreateVerification } from "./types";

const SHA256_DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const PENDING_CREATE_VERIFICATION_KEYS = new Set([
  "schemaVersion",
  "state",
  "gatewayName",
  "gatewayPort",
  "sandboxName",
  "lifecycleGeneration",
  "sandboxIdentityFingerprint",
  "route",
  "policyHash",
  "policyVersion",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate the bounded checkpoint used only while a sandbox create is incomplete. */
export function normalizePendingSandboxCreateVerification(
  value: unknown,
): PendingSandboxCreateVerification | undefined {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !PENDING_CREATE_VERIFICATION_KEYS.has(key)) ||
    value.schemaVersion !== 1 ||
    value.state !== "verified-create" ||
    typeof value.gatewayName !== "string" ||
    value.gatewayName.length === 0 ||
    !Number.isSafeInteger(value.gatewayPort) ||
    Number(value.gatewayPort) < 1 ||
    Number(value.gatewayPort) > 65_535 ||
    typeof value.sandboxName !== "string" ||
    value.sandboxName.length === 0 ||
    typeof value.lifecycleGeneration !== "string" ||
    value.lifecycleGeneration.length === 0 ||
    typeof value.sandboxIdentityFingerprint !== "string" ||
    !SHA256_DIGEST_PATTERN.test(value.sandboxIdentityFingerprint) ||
    (value.route !== "none" && value.route !== "native" && value.route !== "compatibility") ||
    typeof value.policyHash !== "string" ||
    value.policyHash.length === 0 ||
    !Number.isSafeInteger(value.policyVersion) ||
    Number(value.policyVersion) < 1
  ) {
    throw new Error(
      "Sandbox registry contains an invalid pending create verification; repair the registry before continuing",
    );
  }
  return {
    schemaVersion: 1,
    state: "verified-create",
    gatewayName: value.gatewayName,
    gatewayPort: Number(value.gatewayPort),
    sandboxName: value.sandboxName,
    lifecycleGeneration: value.lifecycleGeneration,
    sandboxIdentityFingerprint: value.sandboxIdentityFingerprint,
    route: value.route,
    policyHash: value.policyHash,
    policyVersion: Number(value.policyVersion),
  };
}

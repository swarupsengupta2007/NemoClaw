// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { isObjectRecord } from "../core/json-types";
import type { SandboxEntry } from "./registry/types";
import { normalizePendingSandboxCreateVerification } from "./registry/pending-create-verification";

export { normalizePendingSandboxCreateVerification };

const RESERVATION_SESSION_CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

/**
 * Drop legacy policy-shadow fields without validating or replaying them.
 * OpenShell is the durable policy store; an old or malformed local shadow must
 * neither authorize nor block an unrelated registry command.
 */
export function normalizeSandboxEntry(entry: SandboxEntry): SandboxEntry {
  const legacy = entry as SandboxEntry & Record<string, unknown>;
  const {
    policies: _policies,
    customPolicies: _customPolicies,
    baselineExclusions: _baselineExclusions,
    baselineExclusionTransition: _baselineExclusionTransition,
    policyPresetsFinalized: _policyPresetsFinalized,
    policyTier: _policyTier,
    policyAuthority: _policyAuthority,
    policyCreationReceipt: _policyCreationReceipt,
    pendingPolicyVerification: _pendingPolicyVerification,
    pendingCreateVerification,
    ...rest
  } = legacy;
  const checkpoint = normalizePendingSandboxCreateVerification(pendingCreateVerification);
  return {
    ...(rest as SandboxEntry),
    ...(checkpoint ? { pendingCreateVerification: checkpoint } : {}),
  };
}

export function parseSandboxRegistryEntries(value: unknown): Array<[string, SandboxEntry]> {
  const sandboxes = isObjectRecord(value) ? value : {};
  return Object.entries(sandboxes).filter((entry): entry is [string, SandboxEntry] =>
    isSandboxEntryLike(entry[0], entry[1]),
  );
}

function isSandboxEntryLike(name: string, entry: unknown): entry is SandboxEntry {
  return (
    isObjectRecord(entry) &&
    typeof entry.name === "string" &&
    entry.name === name &&
    entry.name.trim().length > 0
  );
}

export function retainedDefaultSandbox(
  defaultSandbox: string | null,
  sandboxes: Record<string, SandboxEntry>,
): string | null {
  if (defaultSandbox === null) return null;
  if (!Object.prototype.hasOwnProperty.call(sandboxes, defaultSandbox)) return null;
  const entry = sandboxes[defaultSandbox];
  if (!entry || entry.pendingRouteReservation === true) return null;
  return defaultSandbox;
}

// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import { isDeepStrictEqual } from "node:util";

import {
  assertObservedPolicyRequirements,
  assertOpenShellGatewayPortBinding,
  captureSandboxBasePolicy,
  inspectOpenShellSandboxPolicyReadiness,
  inspectSandboxPolicyAuthority,
  PolicyAuthorityRefusalError,
} from "../../adapters/openshell/policy-authority";
import { waitUntil } from "../../core/wait";
import { parseOpenShellPolicy } from "../../policy/merge";
import { normalizePendingSandboxCreateVerification } from "../../state/registry-normalization";
import type { PendingSandboxCreateVerification } from "../../state/registry/types";
import type { SelectedDockerGpuRoute } from "../docker-gpu-route";
import { isOpenShellGpuBaselineEnrichment } from "../sandbox-gpu-route-policy";
import type { VerifiedSandboxPolicyBoundary, VerifiedSandboxPolicyRegistration } from "../types";

export interface CreatedSandboxPolicyVerificationInput {
  readonly sandboxName: string;
  readonly gatewayName: string;
  readonly gatewayPort: number;
  readonly lifecycleGeneration: string;
  readonly lifecycleLiveIdentityFingerprint: string;
  readonly policySourcePath: string;
  readonly route: SelectedDockerGpuRoute;
  readonly operation?: string;
}

export interface CreatedSandboxPolicyVerificationDeps {
  readonly readFile?: typeof fs.readFileSync;
  readonly inspectPolicyReadiness?: typeof inspectOpenShellSandboxPolicyReadiness;
  readonly sleep?: (seconds: number) => void;
}

const POLICY_READINESS_MAX_OBSERVATIONS = 5;
const POLICY_READINESS_POLL_INTERVAL_SECONDS = 1;

/** Flatten one in-memory verified boundary into a bounded incomplete-create checkpoint. */
export function pendingSandboxPolicyVerificationForBoundary(
  boundary: VerifiedSandboxPolicyBoundary,
): PendingSandboxCreateVerification {
  return {
    schemaVersion: 1,
    state: "verified-create",
    gatewayName: boundary.gatewayName,
    gatewayPort: boundary.gatewayPort,
    sandboxName: boundary.sandboxName,
    lifecycleGeneration: boundary.lifecycleGeneration,
    sandboxIdentityFingerprint: boundary.lifecycleLiveIdentityFingerprint,
    ...(boundary.createAttemptNonce
      ? { createAttemptNonce: boundary.createAttemptNonce }
      : {}),
    route: boundary.route,
    policyHash: boundary.registration.policyIdentity.hash,
    policyVersion: boundary.registration.policyIdentity.activeVersion,
  };
}

/** Restore the non-authorizing live observation held by an incomplete create. */
export function verifiedSandboxPolicyBoundaryFromPendingCheckpoint(
  value: unknown,
): VerifiedSandboxPolicyBoundary {
  const checkpoint = normalizePendingSandboxCreateVerification(value);
  if (!checkpoint) {
    throw new PolicyAuthorityRefusalError(
      "Cannot resume sandbox creation without a complete verified policy checkpoint.",
    );
  }
  return {
    sandboxName: checkpoint.sandboxName,
    gatewayName: checkpoint.gatewayName,
    gatewayPort: checkpoint.gatewayPort,
    lifecycleGeneration: checkpoint.lifecycleGeneration,
    lifecycleLiveIdentityFingerprint: checkpoint.sandboxIdentityFingerprint,
    ...(checkpoint.createAttemptNonce
      ? { createAttemptNonce: checkpoint.createAttemptNonce }
      : {}),
    route: checkpoint.route,
    registration: {
      policyIdentity: {
        hash: checkpoint.policyHash,
        activeVersion: checkpoint.policyVersion,
      },
    },
  };
}

function refusal(operation: string, reason: string): never {
  throw new PolicyAuthorityRefusalError(`Refusing to ${operation}: ${reason}.`);
}

function waitForCreatedSandboxPolicyReadiness(
  input: CreatedSandboxPolicyVerificationInput,
  policyVersion: number,
  deps: CreatedSandboxPolicyVerificationDeps,
): void {
  const inspectReadiness = deps.inspectPolicyReadiness ?? inspectOpenShellSandboxPolicyReadiness;
  const lastObservation = {
    reason: "policy-version-pending" as "sandbox-not-ready" | "policy-version-pending",
  };
  const ready = waitUntil(
    () => {
      const readiness = inspectReadiness({
        sandboxName: input.sandboxName,
        gatewayName: input.gatewayName,
        sandboxIdentityFingerprint: input.lifecycleLiveIdentityFingerprint,
        policyVersion,
      });
      if (readiness.state === "ready") return true;
      lastObservation.reason = readiness.reason;
      return false;
    },
    {
      maxAttempts: POLICY_READINESS_MAX_OBSERVATIONS,
      initialIntervalMs: POLICY_READINESS_POLL_INTERVAL_SECONDS * 1_000,
      maxIntervalMs: POLICY_READINESS_POLL_INTERVAL_SECONDS * 1_000,
      backoffFactor: 1,
      sleep: (milliseconds) => {
        if (!deps.sleep) {
          refusal(
            input.operation ?? "verify sandbox creation",
            "the bounded readiness check could not continue",
          );
        }
        deps.sleep(milliseconds / 1_000);
      },
    },
  );
  if (!ready) {
    refusal(
      input.operation ?? "verify sandbox creation",
      lastObservation.reason === "sandbox-not-ready"
        ? "the exact sandbox did not reach Ready during policy verification"
        : "the exact sandbox did not activate the observed policy version",
    );
  }
}

function readRequiredPolicy(
  input: CreatedSandboxPolicyVerificationInput,
  deps: CreatedSandboxPolicyVerificationDeps,
): ReturnType<typeof parseOpenShellPolicy>["policy"] {
  try {
    return parseOpenShellPolicy((deps.readFile ?? fs.readFileSync)(input.policySourcePath, "utf8"))
      .policy;
  } catch {
    refusal(
      input.operation ?? "verify sandbox creation",
      "the required sandbox policy could not be read",
    );
  }
}

function stableLiveObservation(
  input: CreatedSandboxPolicyVerificationInput,
  deps: CreatedSandboxPolicyVerificationDeps,
  requiredPolicy: ReturnType<typeof parseOpenShellPolicy>["policy"],
  allowGpuBaselineEnrichment = false,
): VerifiedSandboxPolicyRegistration {
  const operation = input.operation ?? "verify sandbox creation";
  assertOpenShellGatewayPortBinding({
    gatewayName: input.gatewayName,
    gatewayPort: input.gatewayPort,
  });
  const before = inspectSandboxPolicyAuthority({
    sandboxName: input.sandboxName,
    gatewayName: input.gatewayName,
  });
  const assertRequirements = (
    inspection: ReturnType<typeof inspectSandboxPolicyAuthority>,
  ): void => {
    if (
      allowGpuBaselineEnrichment &&
      input.route !== "none" &&
      isOpenShellGpuBaselineEnrichment(requiredPolicy, inspection.effectivePolicy, input.route)
    ) {
      return;
    }
    assertObservedPolicyRequirements({
      inspection,
      requiredPolicy,
      operation,
      sandboxName: input.sandboxName,
    });
  };
  assertRequirements(before);
  waitForCreatedSandboxPolicyReadiness(input, before.policyIdentity.activeVersion, deps);
  const after = inspectSandboxPolicyAuthority({
    sandboxName: input.sandboxName,
    gatewayName: input.gatewayName,
  });
  if (
    before.policyIdentity.hash !== after.policyIdentity.hash ||
    before.policyIdentity.activeVersion !== after.policyIdentity.activeVersion
  ) {
    refusal(operation, "the live sandbox policy changed during verification");
  }
  assertRequirements(after);
  return { policyIdentity: { ...after.policyIdentity } };
}

/** Verify the live result immediately after an initial policy was supplied at create time. */
export function verifyCreatedSandboxInitialPolicy(
  input: CreatedSandboxPolicyVerificationInput,
  deps: CreatedSandboxPolicyVerificationDeps = {},
): VerifiedSandboxPolicyRegistration {
  const requiredPolicy = readRequiredPolicy(input, deps);
  const registration = stableLiveObservation(input, deps, requiredPolicy, true);
  let livePolicy: ReturnType<typeof parseOpenShellPolicy>["policy"];
  try {
    livePolicy = parseOpenShellPolicy(
      captureSandboxBasePolicy(input.sandboxName, input.gatewayName),
    ).policy;
  } catch {
    refusal(
      input.operation ?? "verify sandbox creation",
      "the live base policy could not be compared",
    );
  }
  if (
    !isDeepStrictEqual(requiredPolicy, livePolicy) &&
    !(
      input.route !== "none" &&
      isOpenShellGpuBaselineEnrichment(requiredPolicy, livePolicy, input.route)
    )
  ) {
    refusal(
      input.operation ?? "verify sandbox creation",
      "the live base policy does not match the policy supplied by this create transaction",
    );
  }
  return registration;
}

/** Verify a policyless APF-selected create without assigning a policy owner. */
export function verifyCreatedApfInterceptorPolicyRegistration(
  input: CreatedSandboxPolicyVerificationInput,
  deps: CreatedSandboxPolicyVerificationDeps = {},
): VerifiedSandboxPolicyRegistration {
  return stableLiveObservation(input, deps, readRequiredPolicy(input, deps));
}

/** Revalidate current live requirements; an earlier hash or source never authorizes this step. */
export function revalidateCreatedSandboxPolicyRegistration(
  input: CreatedSandboxPolicyVerificationInput & {
    readonly registration: VerifiedSandboxPolicyRegistration;
  },
  deps: CreatedSandboxPolicyVerificationDeps = {},
): VerifiedSandboxPolicyRegistration {
  void input.registration;
  return stableLiveObservation(input, deps, readRequiredPolicy(input, deps));
}

// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import * as policies from "../../policy";
import { runCapture } from "../../runner";
import * as sandboxState from "../../state/sandbox";
import type { RebuildBail, RebuildLog } from "./rebuild-credential-preflight";
import { backupSandboxStateForRebuild, type RebuildSandboxEntry } from "./rebuild-flow-helpers";

export type RebuildBackupManifest = Exclude<
  ReturnType<typeof backupSandboxStateForRebuild>,
  undefined
>;

export interface RebuildBackupPhaseInput {
  sandboxName: string;
  sandboxEntry: RebuildSandboxEntry;
  staleRecovery: boolean;
  preparedRecoveryManifest: RebuildBackupManifest;
  messagingPlan: unknown;
  webSearchConfig: unknown;
  force?: boolean;
  log: RebuildLog;
  bail: RebuildBail;
  relockShieldsIfNeeded: (sandboxStillExists: boolean) => boolean;
}

export interface RebuildBackupPhaseResult {
  backupManifest: RebuildBackupManifest;
  backupWasForceSkipped: boolean;
  policyDocument: string;
}

function captureLivePolicy(sandboxName: string): string {
  const boundary = policies.inspectPolicyRecoveryBoundary(
    sandboxName,
    "capture the live policy before rebuild",
  );
  const raw = runCapture(policies.buildPolicyGetCommand(sandboxName, boundary.gatewayName));
  const policyDocument = policies.parseCurrentPolicy(raw);
  if (!policyDocument) {
    throw new Error(`Cannot read the live OpenShell policy for '${sandboxName}'.`);
  }
  return policyDocument;
}

export function runRebuildBackupPhase(
  input: RebuildBackupPhaseInput,
  backupStateForRebuild: typeof backupSandboxStateForRebuild = backupSandboxStateForRebuild,
): RebuildBackupPhaseResult | null {
  let policyDocument: string;
  if (input.preparedRecoveryManifest) {
    policyDocument = sandboxState.readRebuildPolicyHandoff(input.preparedRecoveryManifest) ?? "";
    if (!policyDocument) {
      input.relockShieldsIfNeeded(!input.staleRecovery);
      return input.bail(
        `Rebuild recovery for '${input.sandboxName}' has no verified live-policy handoff.`,
      );
    }
  } else {
    try {
      policyDocument = captureLivePolicy(input.sandboxName);
    } catch (error) {
      input.relockShieldsIfNeeded(!input.staleRecovery);
      return input.bail(
        error instanceof Error
          ? error.message
          : `Cannot read live policy for '${input.sandboxName}'.`,
      );
    }
  }

  let backupManifest =
    input.preparedRecoveryManifest ??
    backupStateForRebuild(
      input.sandboxName,
      input.sandboxEntry,
      input.staleRecovery,
      input.log,
      input.relockShieldsIfNeeded,
      input.bail,
      { force: input.force },
    );
  if (backupManifest === undefined) return null;

  const backupWasForceSkipped =
    input.force === true && !input.staleRecovery && backupManifest === null;
  if (backupManifest && !backupManifest.rebuildPolicyHandoff) {
    try {
      backupManifest = sandboxState.attachRebuildPolicyHandoff(backupManifest, policyDocument);
    } catch (error) {
      input.relockShieldsIfNeeded(true);
      return input.bail(
        `Could not persist the bounded rebuild policy handoff: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return {
    backupManifest,
    backupWasForceSkipped,
    policyDocument,
  };
}

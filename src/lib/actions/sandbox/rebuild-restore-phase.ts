// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { G, R, YW } from "../../cli/terminal-style";
import * as policies from "../../policy";
import * as sandboxConfig from "../../sandbox/config";
import { load as loadRegistry } from "../../state/registry/persistence";
import type { RebuildBackupManifest } from "./rebuild-backup-phase";
import type { RebuildLog } from "./rebuild-credential-preflight";
import * as snapshotRestore from "./snapshot/restore-authority";

export interface RebuildRestorePhaseInput {
  sandboxName: string;
  targetAgentType: string;
  targetImageIsCustom: boolean;
  backupManifest: RebuildBackupManifest;
  policyDocument: string;
  log: RebuildLog;
}

export interface RebuildRestorePhaseResult {
  restoreSucceeded: boolean;
  restoredPresets: string[];
  failedPresets: string[];
  finalPresets: string[];
  finalBuiltinPresets: string[];
  failedPresetRemovals: string[];
  policyPresetReconciliationVerified: boolean;
}

export function runRebuildRestorePhase(input: RebuildRestorePhaseInput): RebuildRestorePhaseResult {
  const { sandboxName, targetAgentType, targetImageIsCustom, backupManifest, policyDocument, log } =
    input;
  let restoreSucceeded = true;
  if (backupManifest) {
    console.log("");
    console.log("  Restoring workspace state...");
    log(`Restoring from: ${backupManifest.backupPath} into sandbox: ${sandboxName}`);
    const restore = snapshotRestore.restoreRecreatedSandboxStateWithManagedAuthority(
      sandboxName,
      backupManifest,
      {
        targetAgentType,
        ...(targetImageIsCustom ? { allowCustomImageWholeStateFileRestore: true } : {}),
      },
      {
        getSandbox: (name) => loadRegistry().sandboxes[name] ?? null,
      },
    );
    restoreSucceeded = restore.success;
    if (
      targetAgentType === "hermes" &&
      restore.restoredDirs.some(
        (directory) => directory === "dashboard-home" || directory === "profiles",
      )
    ) {
      const dashboardTarget = sandboxConfig.resolveAgentConfig(sandboxName);
      const dashboardSeed =
        dashboardTarget.agentName === "hermes"
          ? sandboxConfig.restoreHermesDashboardConfig(sandboxName, dashboardTarget)
          : "failed";
      if (dashboardSeed === "failed") {
        restoreSucceeded = false;
        console.error(
          `  ${YW}Warning:${R} Could not migrate restored Hermes dashboard state into its profile.`,
        );
      }
    }
    if (!restore.success) {
      if (restore.error) console.error(`  Restore blocked: ${restore.error}`);
      console.error(`  Partial restore: ${restore.restoredDirs.join(", ") || "none"}`);
      console.error(`  Failed: ${restore.failedDirs.join(", ")}`);
      if (restore.failedFiles.length > 0) {
        console.error(`  Failed files: ${restore.failedFiles.join(", ")}`);
      }
      console.error(`  Manual restore available from: ${backupManifest.backupPath}`);
    } else if (restoreSucceeded) {
      console.log(
        `  ${G}OK${R} State restored (${restore.restoredDirs.length} directories, ${restore.restoredFiles.length} files)`,
      );
    }
  }

  console.log("");
  console.log("  Restoring the captured live OpenShell policy...");
  const boundary = policies.inspectPolicyMutationBoundary(
    sandboxName,
    "restore the captured rebuild policy",
  );
  const policyRestored = policies.setLivePolicyDocument(sandboxName, policyDocument, {
    boundary,
    operation: "restore the captured rebuild policy",
    nonFatal: true,
  });
  const finalPresets = policyRestored ? (policies.getGatewayPresets(sandboxName) ?? []) : [];
  if (!policyRestored) {
    console.error(
      `  ${YW}Warning:${R} The replacement policy could not be verified; rebuild recovery remains pending.`,
    );
  }
  return {
    restoreSucceeded,
    restoredPresets: finalPresets,
    failedPresets: policyRestored ? [] : ["live-policy"],
    finalPresets,
    finalBuiltinPresets: finalPresets,
    failedPresetRemovals: [],
    policyPresetReconciliationVerified: policyRestored,
  };
}

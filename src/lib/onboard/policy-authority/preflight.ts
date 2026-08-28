// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";

import type { AgentDefinition } from "../../agent/defs";
import {
  assertExternalPolicyRequirements,
  assertObservedPolicyRequirements,
  inspectSandboxPolicyAuthority,
  type SandboxPolicyAuthorityInspection,
} from "../../adapters/openshell/policy-authority";
import { parseOpenShellPolicy } from "../../policy/merge";
import type { SandboxEntry } from "../../state/registry";
import { type InitialSandboxPolicy, prepareInitialSandboxCreatePolicy } from "../initial-policy";
import { requiredObservabilityPolicyPresets } from "../observability-policy-presets";
import { type WebSearchConfig, webSearchProviderForConfig } from "../policy-presets";
import { getDefaultSandboxNameForAgent } from "../sandbox-agent";

const { LOCAL_INFERENCE_POLICY_PROVIDERS } = require("../providers") as {
  LOCAL_INFERENCE_POLICY_PROVIDERS: string[];
};

type PolicyAuthorityInspectionDeps = {
  readonly inspectSandboxPolicyAuthority?: typeof inspectSandboxPolicyAuthority;
};

export type QualifiedSandboxPolicyRequirements = { readonly valid: true };

function parseRequiredPolicy(content: string, operation: string): Record<string, unknown> {
  try {
    return parseOpenShellPolicy(content).policy;
  } catch {
    throw new Error(`Refusing to ${operation}: the required sandbox policy is invalid.`);
  }
}

function readInitialPolicy(policy: InitialSandboxPolicy, operation: string): string {
  if (policy.sourceBytes) return policy.sourceBytes.toString("utf8");
  try {
    return fs.readFileSync(policy.policyPath, "utf8");
  } catch {
    throw new Error(`Refusing to ${operation}: the required sandbox policy is unreadable.`);
  }
}

function cleanupRequirement(policy: InitialSandboxPolicy, operation: string): void {
  if (policy.cleanup && policy.cleanup() !== true) {
    throw new Error(
      `Temporary sandbox policy cleanup failed while trying to ${operation}. Inspect and remove the temporary sandbox policy before retrying.`,
    );
  }
}

function assertLivePolicyRequirements(
  inspection: SandboxPolicyAuthorityInspection,
  requiredPolicy: Record<string, unknown>,
  sandboxName: string,
  operation: string,
): void {
  const assertRequirements =
    inspection.authority === "externally-managed"
      ? assertExternalPolicyRequirements
      : assertObservedPolicyRequirements;
  assertRequirements({ inspection, requiredPolicy, operation, sandboxName });
}

// Validate the current OpenShell result for a live sandbox. No receipt, hash,
// version, or recorded owner can authorize or block the operation.
export function validateLiveSandboxPolicyRequirements(
  input: {
    readonly sandboxName: string;
    readonly gatewayName: string;
    readonly liveExists: boolean;
    readonly prepareRequiredPolicy: () => InitialSandboxPolicy;
    readonly operation: string;
  },
  deps: PolicyAuthorityInspectionDeps = {},
): QualifiedSandboxPolicyRequirements {
  if (!input.liveExists) return { valid: true };

  const requiredPolicy = input.prepareRequiredPolicy();
  let primaryError: unknown;
  try {
    const inspection = (deps.inspectSandboxPolicyAuthority ?? inspectSandboxPolicyAuthority)({
      sandboxName: input.sandboxName,
      gatewayName: input.gatewayName,
    });
    assertLivePolicyRequirements(
      inspection,
      parseRequiredPolicy(readInitialPolicy(requiredPolicy, input.operation), input.operation),
      input.sandboxName,
      input.operation,
    );
  } catch (error) {
    primaryError = error;
  }
  let cleanupError: unknown;
  try {
    cleanupRequirement(requiredPolicy, input.operation);
  } catch (error) {
    cleanupError = error;
  }
  if (primaryError !== undefined && cleanupError !== undefined) {
    throw new AggregateError(
      [primaryError, cleanupError],
      "Live policy validation and temporary policy cleanup both failed.",
    );
  }
  if (primaryError !== undefined) throw primaryError;
  if (cleanupError !== undefined) throw cleanupError;
  return { valid: true };
}

type ProviderPolicyRequirements = {
  readonly gatewayName: string;
  readonly sandboxName: string | null;
  readonly agent: AgentDefinition | null;
  readonly selectedMessagingChannels: readonly string[];
  readonly hermesToolGateways: readonly string[];
  readonly gpuPassthrough: boolean;
  readonly provider: string | null;
  readonly hostLocalInferenceRouteOnly?: boolean;
  readonly webSearchConfig: WebSearchConfig | null;
  readonly observabilityEnabled: boolean;
  readonly operation: string;
};

type RevalidatedPolicyContext = Omit<
  ProviderPolicyRequirements,
  "agent" | "gatewayName" | "observabilityEnabled" | "operation"
> & {
  readonly agent: AgentDefinition | null;
  readonly session: { readonly observabilityEnabled?: boolean | null } | null;
};

export function requiredOnboardPolicyPresets(input: {
  readonly additionalPresets: readonly string[];
  readonly provider: string | null;
  readonly webSearchConfig: WebSearchConfig | null;
  readonly agentName: string | null | undefined;
  readonly observabilityEnabled: boolean;
  readonly hostLocalInferenceRouteOnly?: boolean;
}): string[] {
  const required = new Set(input.additionalPresets);
  if (
    input.provider &&
    !input.hostLocalInferenceRouteOnly &&
    LOCAL_INFERENCE_POLICY_PROVIDERS.includes(input.provider)
  ) {
    required.add("local-inference");
  }
  if (input.webSearchConfig) required.add(webSearchProviderForConfig(input.webSearchConfig));
  for (const preset of requiredObservabilityPolicyPresets(
    input.agentName,
    input.observabilityEnabled,
  )) {
    required.add(preset);
  }
  return [...required];
}

type PolicyRequirementSession = {
  sessionId?: string | null;
};

export function createOnboardPolicyRequirementBindings<Session extends PolicyRequirementSession>(
  runtime: {
    readonly GATEWAY_NAME: string;
    readonly ROOT: string;
    readonly agentDefs: {
      readonly loadAgent: (name: string) => AgentDefinition;
    };
    readonly agentOnboard: {
      readonly getAgentPolicyPath: (agent: AgentDefinition) => string | null;
    };
    readonly inspectSandboxForCreate: (sandboxName: string) => {
      readonly existingEntry: SandboxEntry | null;
      readonly liveExists: boolean;
    };
    readonly onboardSession: {
      loadSession(): Session | null;
      updateSession(mutator: (session: Session) => void): Session | Promise<Session>;
    };
  },
  inspectionDeps: PolicyAuthorityInspectionDeps = {},
): {
  readonly bindPolicyAuthority: (gatewayName: string, session: Session | null) => Promise<Session>;
  readonly preflightPolicyRequirements: (requirements: ProviderPolicyRequirements) => void;
  readonly revalidatePolicyRequirements: (
    context: RevalidatedPolicyContext,
    operation: string,
  ) => void;
} {
  const preflightPolicyRequirements = (requirements: ProviderPolicyRequirements): void => {
    const agent = requirements.agent ?? runtime.agentDefs.loadAgent("openclaw");
    const sandboxName = requirements.sandboxName ?? getDefaultSandboxNameForAgent(agent);
    const observed = runtime.inspectSandboxForCreate(sandboxName);
    validateLiveSandboxPolicyRequirements(
      {
        sandboxName,
        gatewayName: requirements.gatewayName,
        liveExists: observed.liveExists,
        operation: requirements.operation,
        prepareRequiredPolicy: () =>
          prepareInitialSandboxCreatePolicy(
            runtime.agentOnboard.getAgentPolicyPath(agent) ??
              path.join(runtime.ROOT, "nemoclaw-blueprint", "policies", "openclaw-sandbox.yaml"),
            [...requirements.selectedMessagingChannels],
            {
              directGpu: requirements.gpuPassthrough,
              additionalPresets: requiredOnboardPolicyPresets({
                additionalPresets: requirements.hermesToolGateways,
                provider: requirements.provider,
                hostLocalInferenceRouteOnly: requirements.hostLocalInferenceRouteOnly,
                webSearchConfig: requirements.webSearchConfig,
                agentName: agent.name,
                observabilityEnabled: requirements.observabilityEnabled,
              }),
              agentName: agent.name,
              sandboxName,
              policyTier: null,
            },
          ),
      },
      inspectionDeps,
    );
  };
  return {
    async bindPolicyAuthority(_gatewayName, _session) {
      return runtime.onboardSession.updateSession(() => undefined);
    },
    preflightPolicyRequirements,
    revalidatePolicyRequirements(context, operation) {
      preflightPolicyRequirements({
        gatewayName: runtime.GATEWAY_NAME,
        sandboxName: context.sandboxName,
        agent: context.agent ?? runtime.agentDefs.loadAgent("openclaw"),
        selectedMessagingChannels: context.selectedMessagingChannels,
        hermesToolGateways: context.hermesToolGateways,
        gpuPassthrough: context.gpuPassthrough,
        provider: context.provider,
        hostLocalInferenceRouteOnly: context.hostLocalInferenceRouteOnly,
        webSearchConfig: context.webSearchConfig,
        observabilityEnabled: context.session?.observabilityEnabled === true,
        operation,
      });
    },
  };
}

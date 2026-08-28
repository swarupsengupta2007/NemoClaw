// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { isIP } from "node:net";
import { isDeepStrictEqual } from "node:util";
import YAML from "yaml";

import type { AgentMcpAdapter } from "../../agent/defs";
import { diagnosticPreview } from "../../name-validation";
import * as policies from "../../policy";
import { isBlockedMcpUrlTargetHost } from "../../security/mcp-url-target";
import {
  assertTrustedPrivateEndpointCapability,
  replayTrustedPrivateEndpoint,
} from "../../security/trusted-private-endpoint";
import type { McpBridgeEntry } from "../../state/registry";
import * as registry from "../../state/registry";
import {
  isAgentMcpAdapter,
  MCP_BRIDGE_POLICY_SOURCE,
  McpBridgeError,
} from "./mcp-bridge-contracts";
import {
  buildMcpBridgeCapabilityPolicyYaml,
  buildMcpBridgePolicyKey,
  buildMcpBridgePolicyName,
  buildMcpBridgePolicyYaml,
} from "./mcp-bridge-policy-render";
import type { McpBridgeTargetValidation } from "./mcp-bridge-url-validation";

export { MCP_BRIDGE_POLICY_SOURCE } from "./mcp-bridge-contracts";
export {
  buildMcpBridgePolicyKey,
  buildMcpBridgePolicyName,
  buildMcpBridgePolicyYaml,
  MCP_BRIDGE_ALLOWED_METHODS,
  MCP_BRIDGE_POLICY_MAX_BODY_BYTES,
} from "./mcp-bridge-policy-render";

export interface ExactManagedMcpPolicy {
  key: string;
  networkPolicy: unknown;
  policyName: string;
  server: string;
}

export interface ManagedMcpPolicyOmission {
  key?: string;
  policyName?: string;
  server?: string;
  reason: string;
}

export interface ProvableManagedMcpPolicies {
  policies: ExactManagedMcpPolicy[];
  omissions: ManagedMcpPolicyOmission[];
}

export interface GeneratedMcpPolicyRecord {
  name: string;
  content: string;
  sourcePath: typeof MCP_BRIDGE_POLICY_SOURCE;
  pendingContent?: string;
  appliedAt?: string;
}

type ManagedMcpPolicyInspectionDeps = {
  getSandbox: typeof registry.getSandbox;
};

const managedMcpPolicyInspectionDeps: ManagedMcpPolicyInspectionDeps = {
  getSandbox: registry.getSandbox,
};

function parseManagedPolicyDocument(source: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = YAML.parse(source);
  } catch {
    throw new Error(`${label} is not valid YAML`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a YAML mapping`);
  }
  return parsed as Record<string, unknown>;
}

function readManagedNetworkPolicies(
  document: Record<string, unknown>,
  label: string,
): Record<string, unknown> {
  const networkPolicies = document.network_policies;
  if (networkPolicies === undefined || networkPolicies === null) return {};
  if (typeof networkPolicies !== "object" || Array.isArray(networkPolicies)) {
    throw new Error(`${label} network_policies must be a mapping`);
  }
  return networkPolicies as Record<string, unknown>;
}

function resolveCanonicalManagedMcpAdapter(
  sandbox: registry.SandboxEntry,
  bridge: McpBridgeEntry,
): AgentMcpAdapter {
  if (isAgentMcpAdapter(bridge.adapter)) return bridge.adapter;
  switch (sandbox.agent || "openclaw") {
    case "openclaw":
      return "mcporter";
    case "hermes":
      return "hermes-config";
    case "langchain-deepagents-code":
      return "deepagents-config";
    default:
      throw new Error("Managed MCP bridge has no canonical adapter");
  }
}

function recordedTarget(entry: McpBridgeEntry): McpBridgeTargetValidation {
  const addresses = [...(entry.allowedIps ?? [])];
  if (
    addresses.length === 0 ||
    addresses.some(
      (address) =>
        address !== address.toLowerCase() || address.includes("%") || isIP(address) === 0,
    ) ||
    new Set(addresses).size !== addresses.length ||
    !isDeepStrictEqual(addresses, [...addresses].sort())
  ) {
    throw new McpBridgeError(
      `Generated MCP policy '${entry.policyName}' has invalid recorded address pins.`,
    );
  }
  if (entry.trustedPrivateHost) {
    const replay = replayTrustedPrivateEndpoint(entry.trustedPrivateHost, addresses, {
      requireAllPrivate: true,
    });
    return {
      addresses,
      trustedPrivateCapability: replay.trustedPrivateCapability,
      trustedPrivateHost: replay.host,
    };
  }
  if (addresses.some((address) => isBlockedMcpUrlTargetHost(address))) {
    throw new McpBridgeError(
      `Generated MCP policy '${entry.policyName}' has invalid public address pins.`,
    );
  }
  return { addresses };
}

function generatedPolicyContent(
  entry: McpBridgeEntry,
  target: McpBridgeTargetValidation = recordedTarget(entry),
  adapter: AgentMcpAdapter = isAgentMcpAdapter(entry.adapter) ? entry.adapter : "mcporter",
  bindCredential = true,
): string {
  assertMcpBridgePolicyTarget(entry, target);
  return bindCredential
    ? buildMcpBridgePolicyYaml(entry.server, entry.url, adapter, target, entry.providerName ?? "")
    : buildMcpBridgeCapabilityPolicyYaml(entry.server, entry.url, adapter, target);
}

function generatedPolicyRecord(entry: McpBridgeEntry): GeneratedMcpPolicyRecord {
  return {
    name: entry.policyName,
    content: generatedPolicyContent(entry),
    sourcePath: MCP_BRIDGE_POLICY_SOURCE,
  };
}

function requireCanonicalManagedPolicy(
  sandbox: registry.SandboxEntry,
  server: string,
  livePolicies?: Record<string, unknown>,
): ExactManagedMcpPolicy {
  const bridge = sandbox.mcp?.bridges[server];
  if (!bridge || bridge.addState || bridge.server !== server) {
    throw new Error(
      `Managed MCP bridge ${diagnosticPreview(server)} has an incomplete lifecycle transition`,
    );
  }
  const policyName = buildMcpBridgePolicyName(server);
  const key = buildMcpBridgePolicyKey(server);
  if (bridge.policyName !== policyName) {
    throw new Error(`Managed MCP bridge '${server}' has a non-canonical policy name`);
  }
  const expected = parseManagedPolicyDocument(
    generatedPolicyContent(
      bridge,
      recordedTarget(bridge),
      resolveCanonicalManagedMcpAdapter(sandbox, bridge),
    ),
    `Canonical managed MCP policy '${policyName}'`,
  );
  const expectedPolicies = readManagedNetworkPolicies(
    expected,
    `Canonical managed MCP policy '${policyName}'`,
  );
  const expectedPolicy = expectedPolicies[key];
  if (!expectedPolicy || Object.keys(expectedPolicies).length !== 1) {
    throw new Error(`Managed MCP policy '${policyName}' has non-canonical generated content`);
  }
  if (livePolicies) {
    if (!Object.hasOwn(livePolicies, key)) {
      throw new Error(`Managed MCP policy '${policyName}' is absent from the live gateway policy`);
    }
    if (!isDeepStrictEqual(livePolicies[key], expectedPolicy)) {
      throw new Error(`Managed MCP policy '${policyName}' has drifted from its bridge definition`);
    }
  }
  return { key, networkPolicy: expectedPolicy, policyName, server };
}

function inspectCanonicalManagedMcpPolicies(
  sandboxName: string,
  livePolicies: Record<string, unknown> | undefined,
  deps: ManagedMcpPolicyInspectionDeps = managedMcpPolicyInspectionDeps,
): ExactManagedMcpPolicy[] {
  const sandbox = deps.getSandbox(sandboxName);
  if (!sandbox?.mcp) {
    const unclassifiedKey = Object.keys(livePolicies ?? {}).find((key) =>
      key.startsWith("mcp_bridge_"),
    );
    if (unclassifiedKey) {
      throw new Error(
        `Reserved MCP policy key ${diagnosticPreview(unclassifiedKey)} has no committed managed bridge ownership`,
      );
    }
    return [];
  }
  if (sandbox.mcp.destroyPreparedAt || sandbox.mcp.destroyPendingAt) {
    throw new Error("Managed MCP sandbox destruction is incomplete");
  }
  const bridgeEntries = Object.entries(sandbox.mcp.bridges);
  if (bridgeEntries.some(([, bridge]) => bridge.addState !== undefined)) {
    throw new Error("A managed MCP bridge lifecycle transition is incomplete");
  }
  const exact = bridgeEntries.map(([server]) =>
    requireCanonicalManagedPolicy(sandbox, server, livePolicies),
  );
  const keys = new Set(exact.map((entry) => entry.key));
  if (keys.size !== exact.length) {
    throw new Error("Managed MCP policy identity has ambiguous bridge ownership");
  }
  const unclassifiedKey = Object.keys(livePolicies ?? {}).find(
    (key) => key.startsWith("mcp_bridge_") && !keys.has(key),
  );
  if (unclassifiedKey) {
    throw new Error(
      `Reserved MCP policy key ${diagnosticPreview(unclassifiedKey)} has no committed managed bridge ownership`,
    );
  }
  return exact.sort((left, right) => left.key.localeCompare(right.key));
}

export function inspectExactManagedMcpPolicies(
  sandboxName: string,
  livePolicyYaml: string,
  deps: ManagedMcpPolicyInspectionDeps = managedMcpPolicyInspectionDeps,
): ExactManagedMcpPolicy[] {
  const live = readManagedNetworkPolicies(
    parseManagedPolicyDocument(livePolicyYaml, "Live gateway policy"),
    "Live gateway policy",
  );
  return inspectCanonicalManagedMcpPolicies(sandboxName, live, deps);
}

export function inspectRecordedManagedMcpPolicies(
  sandboxName: string,
  deps: ManagedMcpPolicyInspectionDeps = managedMcpPolicyInspectionDeps,
): ExactManagedMcpPolicy[] {
  return inspectCanonicalManagedMcpPolicies(sandboxName, undefined, deps);
}

export function inspectProvableManagedMcpPoliciesForDeadline(
  sandboxName: string,
  livePolicyYaml: string,
  deps: ManagedMcpPolicyInspectionDeps = managedMcpPolicyInspectionDeps,
): ProvableManagedMcpPolicies {
  let livePolicies: Record<string, unknown>;
  try {
    livePolicies = readManagedNetworkPolicies(
      parseManagedPolicyDocument(livePolicyYaml, "Live gateway policy"),
      "Live gateway policy",
    );
  } catch (error) {
    return {
      policies: [],
      omissions: [{ reason: error instanceof Error ? error.message : String(error) }],
    };
  }
  const sandbox = deps.getSandbox(sandboxName);
  if (!sandbox?.mcp) {
    return {
      policies: [],
      omissions: Object.keys(livePolicies)
        .filter((key) => key.startsWith("mcp_bridge_"))
        .map((key) => ({
          key,
          reason: `Reserved MCP policy key '${key}' has no committed bridge`,
        })),
    };
  }
  const exact: ExactManagedMcpPolicy[] = [];
  const omissions: ManagedMcpPolicyOmission[] = [];
  for (const [server] of Object.entries(sandbox.mcp.bridges)) {
    try {
      exact.push(requireCanonicalManagedPolicy(sandbox, server, livePolicies));
    } catch (error) {
      omissions.push({
        server,
        key: buildMcpBridgePolicyKey(server),
        policyName: buildMcpBridgePolicyName(server),
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const exactKeys = new Set(exact.map((entry) => entry.key));
  for (const key of Object.keys(livePolicies)) {
    if (
      key.startsWith("mcp_bridge_") &&
      !exactKeys.has(key) &&
      !omissions.some((entry) => entry.key === key)
    ) {
      omissions.push({
        key,
        reason: `Reserved MCP policy key '${key}' has no exact committed bridge`,
      });
    }
  }
  return {
    policies: exact.sort((a, b) => a.key.localeCompare(b.key)),
    omissions,
  };
}

export function hasManagedMcpPolicyClaims(
  sandboxName: string,
  deps: ManagedMcpPolicyInspectionDeps = managedMcpPolicyInspectionDeps,
): boolean {
  const state = deps.getSandbox(sandboxName)?.mcp;
  return Boolean(
    state &&
    (Object.keys(state.bridges).length > 0 ||
      (state.managedServerNames?.length ?? 0) > 0 ||
      state.destroyPreparedAt ||
      state.destroyPendingAt),
  );
}

export function applyGeneratedPolicy(
  sandboxName: string,
  entry: McpBridgeEntry,
  target: McpBridgeTargetValidation,
  options: { bindCredential?: boolean } = {},
): void {
  const adapter = isAgentMcpAdapter(entry.adapter) ? entry.adapter : "mcporter";
  const bindCredential = options.bindCredential !== false;
  const content = generatedPolicyContent(entry, target, adapter, bindCredential);
  const key = buildMcpBridgePolicyKey(entry.server);
  const state = policies.getPresetContentGatewayState(sandboxName, content, key);
  if (state === "match") return;
  let expectedExistingNetworkPolicyContent: string | null = null;
  if (state !== "absent") {
    const capabilityContent = bindCredential
      ? generatedPolicyContent(entry, target, adapter, false)
      : undefined;
    if (
      !capabilityContent ||
      policies.getPresetContentGatewayState(sandboxName, capabilityContent, key) !== "match"
    ) {
      throw new McpBridgeError(
        `Generated MCP policy '${entry.policyName}' is unreachable or drifted; refusing to replace its live key.`,
      );
    }
    // MCP add first installs this exact credential-free capability policy.
    // Upgrade only that byte-derived policy through the policy layer's live
    // content CAS; any other value at the reserved key remains foreign drift.
    expectedExistingNetworkPolicyContent = capabilityContent;
  }
  const applied = policies.applyPresetContent(sandboxName, entry.policyName, content, {
    expectedExistingNetworkPolicyContent,
    nonFatal: true,
  });
  if (!applied || policies.getPresetContentGatewayState(sandboxName, content, key) !== "match") {
    throw new McpBridgeError(`Failed to activate generated MCP policy '${entry.policyName}'.`);
  }
}

export function assertMcpBridgePolicyTarget(
  entry: McpBridgeEntry,
  target: McpBridgeTargetValidation,
): readonly string[] {
  if (target.addresses.length === 0) {
    throw new McpBridgeError(
      `Refusing to apply generated MCP policy '${entry.policyName}' without exact address pins.`,
    );
  }
  if (!entry.trustedPrivateHost) {
    if (target.trustedPrivateCapability || target.trustedPrivateHost) {
      throw new McpBridgeError(
        `MCP server '${entry.server}' has no durable trusted-private intent. Refusing private policy mutation.`,
      );
    }
    return target.addresses;
  }
  let authority;
  try {
    authority = assertTrustedPrivateEndpointCapability(
      entry.trustedPrivateHost,
      target.addresses,
      target.trustedPrivateCapability,
      { requireAllPrivate: true },
    );
  } catch {
    throw new McpBridgeError(
      `MCP server '${entry.server}' has no provenance-checked capability for its trusted private host.`,
    );
  }
  const recordedPins = entry.allowedIps ?? [];
  if (
    target.trustedPrivateHost !== authority.host ||
    !isDeepStrictEqual(authority.addresses, recordedPins)
  ) {
    throw new McpBridgeError(
      `MCP server '${entry.server}' no longer resolves to its recorded private address pins.`,
      2,
    );
  }
  return recordedPins;
}

function committedBridge(sandboxName: string, entry: McpBridgeEntry): McpBridgeEntry | undefined {
  const candidate = registry.getSandbox(sandboxName)?.mcp?.bridges[entry.server];
  return candidate && !candidate.addState && candidate.policyName === entry.policyName
    ? candidate
    : undefined;
}

export function assertGeneratedPolicyRegistrationMutationSafe(
  sandboxName: string,
  entry: McpBridgeEntry,
): GeneratedMcpPolicyRecord | undefined {
  const committed = committedBridge(sandboxName, entry);
  return committed ? generatedPolicyRecord(committed) : undefined;
}

export function assertGeneratedPolicyMutationSafe(
  sandboxName: string,
  entry: McpBridgeEntry,
): void {
  const record = assertGeneratedPolicyRegistrationMutationSafe(sandboxName, entry);
  if (!record) {
    throw new McpBridgeError(
      `Generated MCP policy '${entry.policyName}' has no matching committed bridge definition.`,
    );
  }
  const state = policies.getPresetContentGatewayState(
    sandboxName,
    record.content,
    buildMcpBridgePolicyKey(entry.server),
  );
  if (state !== "absent" && state !== "match") {
    throw new McpBridgeError(
      `Generated MCP policy '${entry.policyName}' is unreachable or drifted. Refusing mutation.`,
    );
  }
}

export function assertGeneratedPolicyExactReadOnly(
  sandboxName: string,
  entry: McpBridgeEntry,
  adapter: AgentMcpAdapter,
  target: McpBridgeTargetValidation,
): GeneratedMcpPolicyRecord {
  if (
    entry.policyName !== buildMcpBridgePolicyName(entry.server) ||
    entry.adapter !== adapter ||
    !committedBridge(sandboxName, entry)
  ) {
    throw new McpBridgeError("Generated MCP policy ownership is not canonical.");
  }
  const record: GeneratedMcpPolicyRecord = {
    name: entry.policyName,
    content: generatedPolicyContent(entry, target, adapter),
    sourcePath: MCP_BRIDGE_POLICY_SOURCE,
  };
  if (
    policies.getPresetContentGatewayState(
      sandboxName,
      record.content,
      buildMcpBridgePolicyKey(entry.server),
    ) !== "match"
  ) {
    throw new McpBridgeError(
      "Generated MCP policy is absent, unreachable, or drifted from its bridge definition.",
    );
  }
  return record;
}

export function removeGeneratedPolicy(
  sandboxName: string,
  entry: McpBridgeEntry,
  options: { bestEffort?: boolean; preserveRegistryOwnership?: boolean } = {},
): void {
  let content: string;
  try {
    content = generatedPolicyContent(entry);
  } catch (error) {
    if (options.bestEffort) return;
    throw error;
  }
  const key = buildMcpBridgePolicyKey(entry.server);
  let state = policies.getPresetContentGatewayState(sandboxName, content, key);
  if (state === "absent") return;
  if (state === "drift" && entry.addState) {
    const capabilityContent = generatedPolicyContent(
      entry,
      recordedTarget(entry),
      isAgentMcpAdapter(entry.adapter) ? entry.adapter : "mcporter",
      false,
    );
    if (policies.getPresetContentGatewayState(sandboxName, capabilityContent, key) === "match") {
      content = capabilityContent;
      state = "match";
    }
  }
  if (state !== "match") {
    if (options.bestEffort) return;
    throw new McpBridgeError(
      `Generated MCP policy '${entry.policyName}' is unreachable or drifted; refusing removal.`,
    );
  }
  const removed = policies.removePolicyContent(sandboxName, entry.policyName, content, {
    nonFatal: true,
  });
  const after = policies.getPresetContentGatewayState(sandboxName, content, key);
  if (!removed || after !== "absent") {
    if (options.bestEffort) return;
    throw new McpBridgeError(`Failed to remove generated MCP policy '${entry.policyName}'.`);
  }
}

export function getRegisteredGeneratedPolicy(
  sandboxName: string,
  entry: McpBridgeEntry | undefined,
): GeneratedMcpPolicyRecord | undefined {
  if (!entry?.policyName) return undefined;
  const committed = committedBridge(sandboxName, entry);
  return committed ? generatedPolicyRecord(committed) : undefined;
}

export function getPolicyPresence(
  sandboxName: string,
  entry: McpBridgeEntry | undefined,
): boolean | null {
  const record = getRegisteredGeneratedPolicy(sandboxName, entry);
  if (!record || !entry) return false;
  const state = policies.getPresetContentGatewayState(
    sandboxName,
    record.content,
    buildMcpBridgePolicyKey(entry.server),
  );
  return state === "match" ? true : state === "absent" ? false : null;
}

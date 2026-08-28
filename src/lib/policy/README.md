<!-- SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Policy

OpenShell is the sole durable store and authority for sandbox policy. NemoClaw
provides convenience commands for selecting, explaining, and applying common
policy changes; it does not keep a policy desired-state copy in its registry or
completed onboarding session.

## Live policy boundary

Every policy mutation:

1. resolves the sandbox's current gateway,
2. reads the current OpenShell base policy,
3. computes only the requested scoped change,
4. writes through OpenShell,
5. reads the policy back and verifies the requested result, and
6. persists no policy content, hash, version, owner, tier, preset attribution,
   custom-policy content, or baseline-exclusion journal.

Policy source metadata such as `sandbox` or `global` is diagnostic. A host-side
change made through the OpenShell TUI, CLI, gateway, interceptor, or an
operator-managed file is valid and must survive unrelated NemoClaw mutations.
When a write result is ambiguous, the live reread decides whether the requested
change happened.

Built-in preset state is derived from live rule content. Custom policy commands
encode their identity in OpenShell-owned rule keys so list and remove operations
do not need saved YAML.

## Lifecycle operations

Onboarding may supply an initial policy, including policyless creation through
`--apf-interceptor`. Once OpenShell creates the sandbox, its live policy is
authoritative.

Rebuild and snapshot clone operations read the live policy before deletion or
creation. They use a mode-`0600` exact handoff only for the active operation,
and remove it after successful completion. A destructive operation stops before
deletion when the current policy cannot be read.

Shields-down state is also bounded to the active transaction. Shields restoration
reverts only the relaxation delta and preserves policy changes made while Shields
was down. A failed restore retains the transaction for recovery; a verified
restore removes it.

Policy-dependent credential and provider work runs only after the required live
policy mutation has been verified.

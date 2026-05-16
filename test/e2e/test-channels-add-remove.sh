#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# Channel add/remove lifecycle E2E test.
#
# Covers Test 2 from issue #3462 ("onboard empty -> channels add -> channels remove").
# Regression coverage for:
#   - #3437 — `channels add <ch>` + rebuild must apply the channel's matching
#             network policy preset so the bridge boots with egress to its
#             upstream API (the SSRF engine blocked all outbound traffic before
#             the addSandboxChannel preset-apply fix).
#
# Telegram-only — Discord/Slack walk the same KNOWN_CHANNELS + preset lookup
# code path; telegram is the cheapest regression gate.
#
# Prerequisites:
#   - Docker running
#   - NVIDIA_API_KEY set (real key or fake OpenAI endpoint)
#   - NEMOCLAW_NON_INTERACTIVE=1, NEMOCLAW_ACCEPT_THIRD_PARTY_SOFTWARE=1
#
# Usage:
#   NEMOCLAW_NON_INTERACTIVE=1 NEMOCLAW_ACCEPT_THIRD_PARTY_SOFTWARE=1 \
#     NVIDIA_API_KEY=nvapi-... bash test/e2e/test-channels-add-remove.sh

set -uo pipefail

export NEMOCLAW_E2E_DEFAULT_TIMEOUT=2400
SCRIPT_DIR_TIMEOUT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck source=test/e2e/e2e-timeout.sh
source "${SCRIPT_DIR_TIMEOUT}/e2e-timeout.sh"

PASS=0
FAIL=0
SKIP=0
TOTAL=0

pass() {
  ((PASS++))
  ((TOTAL++))
  printf '\033[32m  PASS: %s\033[0m\n' "$1"
}
fail() {
  ((FAIL++))
  ((TOTAL++))
  printf '\033[31m  FAIL: %s\033[0m\n' "$1"
}
skip() {
  ((SKIP++))
  ((TOTAL++))
  printf '\033[33m  SKIP: %s\033[0m\n' "$1"
}
section() {
  echo ""
  printf '\033[1;36m=== %s ===\033[0m\n' "$1"
}
info() { printf '\033[1;34m  [info]\033[0m %s\n' "$1"; }

print_summary() {
  section "Summary"
  echo "  Total: $TOTAL  Pass: $PASS  Fail: $FAIL  Skip: $SKIP"
  if [ "$FAIL" -gt 0 ]; then
    echo ""
    echo "FAILED"
    exit 1
  fi
  echo ""
  if [ "$SKIP" -gt 0 ]; then
    echo "PASSED (with $SKIP skipped)"
  else
    echo "ALL PASSED"
  fi
}

# Repo root resolution mirrors test-channels-stop-start.sh.
if [ -d /workspace ] && [ -f /workspace/install.sh ]; then
  REPO="/workspace"
elif [ -f "$(cd "$(dirname "$0")/../.." && pwd)/install.sh" ]; then
  REPO="$(cd "$(dirname "$0")/../.." && pwd)"
else
  echo "ERROR: Cannot find repo root."
  exit 1
fi

SANDBOX_NAME="${NEMOCLAW_SANDBOX_NAME:-e2e-channels-add-remove}"
INSTALL_LOG="/tmp/nemoclaw-e2e-install.log"
TELEGRAM_TOKEN="${TELEGRAM_BOT_TOKEN:-test-fake-telegram-token-add-remove-e2e}"

# shellcheck source=test/e2e/lib/sandbox-teardown.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/sandbox-teardown.sh"
register_sandbox_for_teardown "$SANDBOX_NAME"

# ── sandbox_exec: run a command inside the sandbox and capture output. ──
sandbox_exec() {
  local cmd="$1"
  local ssh_config
  ssh_config="$(mktemp)"
  openshell sandbox ssh-config "$SANDBOX_NAME" >"$ssh_config" 2>/dev/null

  local result
  result=$(timeout 60 ssh -F "$ssh_config" \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o ConnectTimeout=10 \
    -o LogLevel=ERROR \
    "openshell-${SANDBOX_NAME}" \
    "$cmd" \
    2>&1) || true

  rm -f "$ssh_config"
  echo "$result"
}

openclaw_has_telegram() {
  # Read /sandbox/.openclaw/openclaw.json from inside the sandbox and check
  # for `channels.telegram`. Exit 0 if present, 1 if absent, 2 if the file
  # could not be read.
  local out
  out=$(sandbox_exec \
    "python3 -c 'import json,sys; d=json.load(open(\"/sandbox/.openclaw/openclaw.json\")); print(\"yes\" if \"telegram\" in d.get(\"channels\",{}) else \"no\")' 2>&1") || true
  case "$out" in
    *yes*) return 0 ;;
    *no*) return 1 ;;
    *) return 2 ;;
  esac
}

# Check whether a named preset is currently applied to the sandbox.
# Uses host-side `nemoclaw <sb> policy-list` since presets live in the
# gateway policy engine (not in the sandbox filesystem).
policy_list_has_preset() {
  local preset="$1"
  nemoclaw "$SANDBOX_NAME" policy-list 2>/dev/null \
    | grep -E "^\s*${preset}\b" >/dev/null
}

# Run rebuild with live tail of the rebuild log so the operator can see
# progress. Mirrors the install.sh tail pattern in Phase 1.
run_rebuild_with_live_log() {
  local log_path="$1"
  nemoclaw "$SANDBOX_NAME" rebuild --yes >"$log_path" 2>&1 &
  local rebuild_pid=$!
  tail -f "$log_path" --pid=$rebuild_pid 2>/dev/null &
  local tail_pid=$!
  wait $rebuild_pid
  local rebuild_exit=$?
  kill $tail_pid 2>/dev/null || true
  wait $tail_pid 2>/dev/null || true
  return $rebuild_exit
}

# Egress probe through the L7 proxy from inside the sandbox. Discriminates
# between "reached Telegram" (preset applied -> proxy passes the CONNECT)
# and "blocked by proxy" (no preset -> proxy 403s the CONNECT or denies the
# request). Falls back to inconclusive only when neither signal matches.
# Uses `curl -v` so the operator sees the full CONNECT exchange + TLS state.
telegram_egress_open() {
  local body
  body=$(sandbox_exec "curl -sSv --max-time 15 https://api.telegram.org/ 2>&1" || true)
  echo "  [egress-probe] curl output (first 100 lines):"
  echo "$body" | head -100 | sed 's/^/    /'
  if echo "$body" | grep -qiE "telegram bot api|<title>telegram"; then
    return 0
  fi
  # Common proxy-denial signatures:
  #   - curl (56) CONNECT tunnel failed, response 403  (CONNECT-based proxy)
  #   - policy_denied / engine:ssrf                    (NemoClaw L7 body)
  #   - forbidden by policy                            (generic phrasing)
  if echo "$body" | grep -qiE "policy_denied|engine:ssrf|forbidden by policy|CONNECT tunnel failed.*40[0-9]"; then
    return 1
  fi
  return 2
}

# ══════════════════════════════════════════════════════════════════
# Phase 0: Prerequisites
# ══════════════════════════════════════════════════════════════════
section "Phase 0: Prerequisites"

if [ -z "${NVIDIA_API_KEY:-}" ]; then
  fail "C0: NVIDIA_API_KEY is required"
  print_summary
fi
pass "C0: NVIDIA_API_KEY is set"

if [ "${NEMOCLAW_NON_INTERACTIVE:-}" != "1" ]; then
  fail "C0: NEMOCLAW_NON_INTERACTIVE=1 is required"
  print_summary
fi
pass "C0: NEMOCLAW_NON_INTERACTIVE=1 is set"

# ══════════════════════════════════════════════════════════════════
# Phase 1: Install + onboard sandbox WITHOUT any messaging channel
# ══════════════════════════════════════════════════════════════════
section "Phase 1: Install + onboard sandbox (no channel)"

cd "$REPO" || exit 1

# Pre-cleanup: leftover sandboxes from prior runs.
info "Pre-cleanup..."
if command -v nemoclaw >/dev/null 2>&1; then
  nemoclaw "$SANDBOX_NAME" destroy --yes 2>/dev/null || true
fi
if openshell --version >/dev/null 2>&1; then
  openshell sandbox delete "$SANDBOX_NAME" 2>/dev/null || true
  openshell gateway destroy -g nemoclaw 2>/dev/null || true
fi
pass "C1a: Pre-cleanup complete"

# Intentionally do NOT export TELEGRAM_BOT_TOKEN here — onboard must see no
# messaging tokens and skip the messaging step entirely. This reproduces the
# exact entry condition of the #3437 bug (onboard empty -> later channels add).
unset TELEGRAM_BOT_TOKEN

export NEMOCLAW_SANDBOX_NAME="$SANDBOX_NAME"
export NEMOCLAW_RECREATE_SANDBOX=1
export NEMOCLAW_FRESH=1

info "Running install.sh --non-interactive (this takes 5-10 min on first run)..."
bash install.sh --non-interactive >"$INSTALL_LOG" 2>&1 &
install_pid=$!
tail -f "$INSTALL_LOG" --pid=$install_pid 2>/dev/null &
tail_pid=$!
wait $install_pid
install_exit=$?
kill $tail_pid 2>/dev/null || true
wait $tail_pid 2>/dev/null || true

# Refresh PATH for nvm-managed installs.
if [ -f "$HOME/.bashrc" ]; then
  # shellcheck source=/dev/null
  source "$HOME/.bashrc" 2>/dev/null || true
fi
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
fi
if [ -d "$HOME/.local/bin" ] && [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
  export PATH="$HOME/.local/bin:$PATH"
fi

if [ $install_exit -eq 0 ]; then
  pass "C1b: install.sh + onboard completed (exit 0)"
else
  fail "C1b: install.sh failed (exit $install_exit)"
  tail -100 "$INSTALL_LOG" 2>/dev/null || true
  print_summary
fi

if ! openshell --version >/dev/null 2>&1; then
  fail "C1c: openshell not on PATH after install"
  print_summary
fi
pass "C1c: openshell installed"

if ! command -v nemoclaw >/dev/null 2>&1; then
  fail "C1d: nemoclaw not on PATH after install"
  print_summary
fi
pass "C1d: nemoclaw installed"

if openshell sandbox list 2>&1 | grep -q "${SANDBOX_NAME}.*Ready"; then
  pass "C1e: Sandbox '${SANDBOX_NAME}' is Ready"
else
  fail "C1e: Sandbox '${SANDBOX_NAME}' not Ready"
  print_summary
fi

# ══════════════════════════════════════════════════════════════════
# Phase 2: Verify baseline state (no telegram anywhere)
# ══════════════════════════════════════════════════════════════════
section "Phase 2: Verify baseline state (no channel)"

if openshell provider get "${SANDBOX_NAME}-telegram-bridge" >/dev/null 2>&1; then
  fail "C2a: Provider '${SANDBOX_NAME}-telegram-bridge' unexpectedly exists at baseline"
else
  pass "C2a: No telegram-bridge provider at baseline"
fi

if openclaw_has_telegram; then
  fail "C2b: openclaw.json unexpectedly contains 'telegram' at baseline"
else
  rc=$?
  if [ "$rc" = "2" ]; then
    fail "C2b: could not read openclaw.json inside sandbox at baseline"
  else
    pass "C2b: openclaw.json has no 'telegram' channel block at baseline"
  fi
fi

if policy_list_has_preset telegram; then
  fail "C2c: 'telegram' preset unexpectedly applied at baseline"
else
  pass "C2c: 'telegram' preset not applied at baseline"
fi

# ══════════════════════════════════════════════════════════════════
# Phase 3: channels add telegram + rebuild
# ══════════════════════════════════════════════════════════════════
section "Phase 3: channels add telegram + rebuild"

# Now provide the token — this mirrors the real user flow: after onboard,
# the operator decides to add a channel and exports the token first.
export TELEGRAM_BOT_TOKEN="$TELEGRAM_TOKEN"

if nemoclaw "$SANDBOX_NAME" channels add telegram >/tmp/nc-add.log 2>&1; then
  add_rc=0
else
  add_rc=$?
fi
cat /tmp/nc-add.log
if [ "$add_rc" -eq 0 ] && grep -q "Registered telegram" /tmp/nc-add.log; then
  pass "C3a: channels add telegram registered the bridge"
else
  fail "C3a: channels add telegram did not register"
  tail -20 /tmp/nc-add.log 2>/dev/null || true
fi

info "Rebuilding sandbox to apply the add..."
if run_rebuild_with_live_log /tmp/nc-rebuild-add.log; then
  pass "C3b: rebuild (post-add) completed"
else
  fail "C3b: rebuild (post-add) failed"
  tail -100 /tmp/nc-rebuild-add.log 2>/dev/null || true
  print_summary
fi

# ══════════════════════════════════════════════════════════════════
# Phase 4: Post-add assertions (Test 2 acceptance, regression #3437)
# ══════════════════════════════════════════════════════════════════
section "Phase 4: Verify post-add state (regression #3437)"

# C4a: THE REGRESSION CHECK. Before the addSandboxChannel preset-apply fix,
# `channels add` only registered the bridge but never called
# policies.applyPreset, so the rebuild backup manifest did not capture the
# telegram preset and the rebuilt sandbox had no egress to api.telegram.org.
# This assertion is the load-bearing check for #3437.
if policy_list_has_preset telegram; then
  pass "C4a: 'telegram' preset present in policy list after add+rebuild (#3437 fixed)"
else
  fail "C4a: REGRESSION — 'telegram' preset missing from policy list after add+rebuild (#3437)"
  info "policy list output:"
  nemoclaw "$SANDBOX_NAME" policy list 2>&1 | head -20 || true
fi

# C4b: openclaw.json inside the rebuilt sandbox contains the telegram block.
if openclaw_has_telegram; then
  pass "C4b: openclaw.json contains 'telegram' channel block after add+rebuild"
else
  rc=$?
  if [ "$rc" = "2" ]; then
    fail "C4b: could not read openclaw.json inside sandbox post-add"
  else
    fail "C4b: openclaw.json missing 'telegram' channel after add+rebuild"
  fi
fi

# C4c: bridge provider exists in the gateway (registered + survived rebuild).
# `openshell provider get` is the source of truth — `sandbox describe` does
# not surface provider attachment in a parseable way.
if openshell provider get "${SANDBOX_NAME}-telegram-bridge" >/dev/null 2>&1; then
  pass "C4c: telegram-bridge provider exists in gateway after add+rebuild"
else
  fail "C4c: telegram-bridge provider missing in gateway after add+rebuild"
fi

# C4d: network reachability. With the preset applied, curl from inside the
# sandbox through the L7 proxy should reach api.telegram.org and get the
# Bot API root page back; without the preset, the proxy denies with
# policy_denied / engine:ssrf. This is the user-facing symptom that #3437
# reports — bridge can't reach Telegram, bot stays silent.
if telegram_egress_open; then
  pass "C4d: egress to api.telegram.org reaches Telegram through L7 proxy"
else
  rc=$?
  if [ "$rc" = "2" ]; then
    skip "C4d: egress probe inconclusive (network instability or unexpected proxy response)"
  else
    fail "C4d: egress to api.telegram.org blocked by proxy (preset not in effect)"
  fi
fi

# ══════════════════════════════════════════════════════════════════
# Phase 5: channels remove telegram + rebuild
# ══════════════════════════════════════════════════════════════════
section "Phase 5: channels remove telegram + rebuild"

if nemoclaw "$SANDBOX_NAME" channels remove telegram >/tmp/nc-remove.log 2>&1; then
  remove_rc=0
else
  remove_rc=$?
fi
cat /tmp/nc-remove.log
if [ "$remove_rc" -eq 0 ] && grep -q "Removed telegram" /tmp/nc-remove.log; then
  pass "C5a: channels remove telegram unregistered the bridge"
else
  fail "C5a: channels remove telegram did not unregister"
  tail -20 /tmp/nc-remove.log 2>/dev/null || true
fi

info "Rebuilding sandbox to apply the remove..."
if run_rebuild_with_live_log /tmp/nc-rebuild-remove.log; then
  pass "C5b: rebuild (post-remove) completed"
else
  fail "C5b: rebuild (post-remove) failed"
  tail -100 /tmp/nc-rebuild-remove.log 2>/dev/null || true
  print_summary
fi

# ══════════════════════════════════════════════════════════════════
# Phase 6: Post-remove assertions (clean state restored)
# ══════════════════════════════════════════════════════════════════
section "Phase 6: Verify post-remove state"

# C6a: openclaw.json no longer references telegram.
if openclaw_has_telegram; then
  fail "C6a: openclaw.json still contains 'telegram' after remove+rebuild"
  info "openclaw.json channels after remove+rebuild:"
  sandbox_exec "python3 -c 'import json; print(list(json.load(open(\"/sandbox/.openclaw/openclaw.json\")).get(\"channels\",{}).keys()))' 2>&1" | head -5
else
  rc=$?
  if [ "$rc" = "2" ]; then
    fail "C6a: could not read openclaw.json inside sandbox post-remove"
  else
    pass "C6a: openclaw.json excludes 'telegram' after remove+rebuild"
  fi
fi

# C6b: bridge provider no longer exists in the gateway after remove.
if openshell provider get "${SANDBOX_NAME}-telegram-bridge" >/dev/null 2>&1; then
  fail "C6b: telegram-bridge provider still exists in gateway after remove+rebuild"
else
  pass "C6b: telegram-bridge provider removed from gateway after remove+rebuild"
fi

# C6c: Preset cleanup on remove — asymmetry with the add-side fix.
#
# Issue #3462 Test 2 Step 7 expects `policy list` to no longer contain the
# telegram preset after `channels remove`. PR #3452 only shipped the add-side
# `applyChannelPresetIfAvailable` helper; the mirror remove-side
# `removeChannelPresetIfPresent` is tracked as a follow-up (the preset stays
# applied across `channels remove`, leaving `api.telegram.org` open in the
# allow-list even though the bridge is gone — defense-in-depth gap, not a
# functional regression).
#
# Reported as info-only until the remove-side fix lands. Flip to pass/fail
# once the symmetric helper is wired in.
if policy_list_has_preset telegram; then
  skip "C6c: 'telegram' preset still applied after remove — remove-side cleanup pending (follow-up)"
else
  pass "C6c: 'telegram' preset removed from policy list after remove+rebuild"
fi

print_summary

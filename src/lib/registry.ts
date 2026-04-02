// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Multi-sandbox registry at ~/.nemoclaw/sandboxes.json

import fs from "node:fs";
import path from "node:path";

import { readConfigFile, writeConfigFile } from "./config-io";

const REGISTRY_FILE = path.join(process.env.HOME || "/tmp", ".nemoclaw", "sandboxes.json");
const LOCK_DIR = REGISTRY_FILE + ".lock";
const LOCK_OWNER = path.join(LOCK_DIR, "owner");
const LOCK_STALE_MS = 10_000;
const LOCK_RETRY_MS = 100;
const LOCK_MAX_RETRIES = 120;

export interface SandboxEntry {
  name: string;
  createdAt?: string;
  model?: string | null;
  nimContainer?: string | null;
  provider?: string | null;
  gpuEnabled?: boolean;
  policies?: string[];
}

export interface RegistryData {
  sandboxes: Record<string, SandboxEntry>;
  defaultSandbox: string | null;
}

/**
 * Acquire an advisory lock using mkdir (atomic on POSIX).
 * Writes an owner file with PID for stale-lock detection via process liveness.
 */
export function acquireLock(): void {
  fs.mkdirSync(path.dirname(REGISTRY_FILE), { recursive: true, mode: 0o700 });
  const sleepBuf = new Int32Array(new SharedArrayBuffer(4));
  for (let i = 0; i < LOCK_MAX_RETRIES; i++) {
    try {
      fs.mkdirSync(LOCK_DIR);
      const ownerTmp = LOCK_OWNER + ".tmp." + process.pid;
      try {
        fs.writeFileSync(ownerTmp, String(process.pid), { mode: 0o600 });
        fs.renameSync(ownerTmp, LOCK_OWNER);
      } catch (ownerErr) {
        try {
          fs.unlinkSync(ownerTmp);
        } catch {
          /* best effort */
        }
        try {
          fs.unlinkSync(LOCK_OWNER);
        } catch {
          /* best effort */
        }
        try {
          fs.rmdirSync(LOCK_DIR);
        } catch {
          /* best effort */
        }
        throw ownerErr;
      }
      return;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      let ownerChecked = false;
      try {
        const ownerPid = parseInt(fs.readFileSync(LOCK_OWNER, "utf-8").trim(), 10);
        if (Number.isFinite(ownerPid) && ownerPid > 0) {
          ownerChecked = true;
          let alive: boolean;
          try {
            process.kill(ownerPid, 0);
            alive = true;
          } catch (killErr: unknown) {
            alive = (killErr as NodeJS.ErrnoException).code === "EPERM";
          }
          if (!alive) {
            const recheck = parseInt(fs.readFileSync(LOCK_OWNER, "utf-8").trim(), 10);
            if (recheck === ownerPid) {
              fs.rmSync(LOCK_DIR, { recursive: true, force: true });
              continue;
            }
          }
        }
      } catch {
        // No owner file or lock dir released
      }
      if (!ownerChecked) {
        try {
          const stat = fs.statSync(LOCK_DIR);
          if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
            fs.rmSync(LOCK_DIR, { recursive: true, force: true });
            continue;
          }
        } catch {
          continue;
        }
      }
      Atomics.wait(sleepBuf, 0, 0, LOCK_RETRY_MS);
    }
  }
  throw new Error(`Failed to acquire lock on ${REGISTRY_FILE} after ${LOCK_MAX_RETRIES} retries`);
}

export function releaseLock(): void {
  try {
    fs.unlinkSync(LOCK_OWNER);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  try {
    fs.rmSync(LOCK_DIR, { recursive: true, force: true });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

export function withLock<T>(fn: () => T): T {
  acquireLock();
  try {
    return fn();
  } finally {
    releaseLock();
  }
}

export function load(): RegistryData {
  return readConfigFile(REGISTRY_FILE, { sandboxes: {}, defaultSandbox: null });
}

export function save(data: RegistryData): void {
  writeConfigFile(REGISTRY_FILE, data);
}

export function getSandbox(name: string): SandboxEntry | null {
  const data = load();
  return data.sandboxes[name] || null;
}

export function getDefault(): string | null {
  const data = load();
  if (data.defaultSandbox && data.sandboxes[data.defaultSandbox]) {
    return data.defaultSandbox;
  }
  const names = Object.keys(data.sandboxes);
  return names.length > 0 ? names[0] : null;
}

export function registerSandbox(entry: SandboxEntry): void {
  withLock(() => {
    const data = load();
    data.sandboxes[entry.name] = {
      name: entry.name,
      createdAt: entry.createdAt || new Date().toISOString(),
      model: entry.model || null,
      nimContainer: entry.nimContainer || null,
      provider: entry.provider || null,
      gpuEnabled: entry.gpuEnabled || false,
      policies: entry.policies || [],
    };
    if (!data.defaultSandbox) {
      data.defaultSandbox = entry.name;
    }
    save(data);
  });
}

export function updateSandbox(
  name: string,
  updates: Partial<SandboxEntry>,
): boolean {
  return withLock(() => {
    const data = load();
    if (!data.sandboxes[name]) return false;
    if (
      Object.prototype.hasOwnProperty.call(updates, "name") &&
      updates.name !== name
    ) {
      return false;
    }
    Object.assign(data.sandboxes[name], updates);
    save(data);
    return true;
  });
}

export function removeSandbox(name: string): boolean {
  return withLock(() => {
    const data = load();
    if (!data.sandboxes[name]) return false;
    delete data.sandboxes[name];
    if (data.defaultSandbox === name) {
      const remaining = Object.keys(data.sandboxes);
      data.defaultSandbox = remaining.length > 0 ? remaining[0] : null;
    }
    save(data);
    return true;
  });
}

export function listSandboxes(): {
  sandboxes: SandboxEntry[];
  defaultSandbox: string | null;
} {
  const data = load();
  return {
    sandboxes: Object.values(data.sandboxes),
    defaultSandbox: data.defaultSandbox,
  };
}

export function setDefault(name: string): boolean {
  return withLock(() => {
    const data = load();
    if (!data.sandboxes[name]) return false;
    data.defaultSandbox = name;
    save(data);
    return true;
  });
}

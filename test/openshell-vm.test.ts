// @ts-nocheck
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  isOpenshellVmAvailable,
  getInstalledOpenshellVmVersion,
} from "../dist/lib/openshell";
import {
  createSession,
  normalizeSession,
  filterSafeUpdates,
} from "../dist/lib/onboard-session";

describe("openshell-vm detection", () => {
  describe("isOpenshellVmAvailable", () => {
    it("returns true when openshell-vm binary is found", () => {
      expect(isOpenshellVmAvailable({ whichImpl: () => true })).toBe(true);
    });

    it("returns false when openshell-vm binary is not found", () => {
      expect(isOpenshellVmAvailable({ whichImpl: () => false })).toBe(false);
    });

    it("passes the correct binary name to whichImpl", () => {
      let calledWith = null;
      isOpenshellVmAvailable({
        whichImpl: (bin) => {
          calledWith = bin;
          return false;
        },
      });
      expect(calledWith).toBe("openshell-vm");
    });
  });

  describe("getInstalledOpenshellVmVersion", () => {
    it("parses version from openshell-vm output", () => {
      const result = getInstalledOpenshellVmVersion("openshell-vm", {
        spawnSyncImpl: () => ({
          status: 0,
          stdout: "openshell-vm 0.0.26\n",
          stderr: "",
          error: null,
        }),
      });
      expect(result).toBe("0.0.26");
    });

    it("parses dev version strings", () => {
      const result = getInstalledOpenshellVmVersion("openshell-vm", {
        spawnSyncImpl: () => ({
          status: 0,
          stdout: "openshell-vm 0.0.27-dev.3+gabcdef1\n",
          stderr: "",
          error: null,
        }),
      });
      expect(result).toBe("0.0.27");
    });

    it("returns null when binary is not found", () => {
      const result = getInstalledOpenshellVmVersion("openshell-vm", {
        spawnSyncImpl: () => ({
          status: 1,
          stdout: "",
          stderr: "not found",
          error: null,
        }),
      });
      expect(result).toBe(null);
    });
  });
});

describe("session gatewayBackend field", () => {
  it("createSession defaults gatewayBackend to null", () => {
    const session = createSession();
    expect(session.gatewayBackend).toBe(null);
  });

  it("createSession accepts gatewayBackend override", () => {
    const session = createSession({ gatewayBackend: "vm" });
    expect(session.gatewayBackend).toBe("vm");
  });

  it("normalizeSession preserves valid gatewayBackend values", () => {
    const raw = createSession({ gatewayBackend: "docker" });
    const normalized = normalizeSession(raw);
    expect(normalized.gatewayBackend).toBe("docker");
  });

  it("normalizeSession rejects invalid gatewayBackend values", () => {
    const raw = createSession();
    raw.gatewayBackend = "invalid";
    const normalized = normalizeSession(raw);
    expect(normalized.gatewayBackend).toBe(null);
  });

  it("filterSafeUpdates passes through valid gatewayBackend", () => {
    const safe = filterSafeUpdates({ gatewayBackend: "vm" });
    expect(safe.gatewayBackend).toBe("vm");
  });

  it("filterSafeUpdates ignores invalid gatewayBackend", () => {
    const safe = filterSafeUpdates({ gatewayBackend: "bogus" });
    expect(safe.gatewayBackend).toBeUndefined();
  });
});

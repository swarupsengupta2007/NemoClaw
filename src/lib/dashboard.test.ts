// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveDashboardForwardTarget, buildControlUiUrls } from "./dashboard";

describe("resolveDashboardForwardTarget", () => {
  it("returns port-only for localhost URL", () => {
    expect(resolveDashboardForwardTarget("http://127.0.0.1:18789")).toBe("18789");
  });

  it("returns port-only for localhost hostname", () => {
    expect(resolveDashboardForwardTarget("http://localhost:18789")).toBe("18789");
  });

  it("binds to 0.0.0.0 for non-loopback URL", () => {
    expect(resolveDashboardForwardTarget("http://my-server.example.com:18789")).toBe(
      "0.0.0.0:18789",
    );
  });

  it("returns port-only for empty input", () => {
    expect(resolveDashboardForwardTarget("")).toBe("18789");
  });

  it("returns port-only for default", () => {
    expect(resolveDashboardForwardTarget()).toBe("18789");
  });

  it("handles URL without scheme", () => {
    expect(resolveDashboardForwardTarget("remote-host:18789")).toBe("0.0.0.0:18789");
  });

  it("handles invalid URL with localhost", () => {
    expect(resolveDashboardForwardTarget("://localhost:bad")).toBe("18789");
  });

  it("handles invalid URL with non-localhost", () => {
    expect(resolveDashboardForwardTarget("://remote:bad")).toBe("0.0.0.0:18789");
  });
});

describe("buildControlUiUrls", () => {
  const originalEnv = process.env.CHAT_UI_URL;

  beforeEach(() => {
    delete process.env.CHAT_UI_URL;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.CHAT_UI_URL = originalEnv;
    } else {
      delete process.env.CHAT_UI_URL;
    }
  });

  it("builds URL with token hash", () => {
    const urls = buildControlUiUrls("my-token");
    expect(urls).toEqual(["http://127.0.0.1:18789/#token=my-token"]);
  });

  it("builds URL without token", () => {
    const urls = buildControlUiUrls(null);
    expect(urls).toEqual(["http://127.0.0.1:18789/"]);
  });

  it("includes CHAT_UI_URL when set", () => {
    process.env.CHAT_UI_URL = "https://my-dashboard.example.com";
    const urls = buildControlUiUrls("tok");
    expect(urls).toHaveLength(2);
    expect(urls[1]).toBe("https://my-dashboard.example.com/#token=tok");
  });

  it("deduplicates when CHAT_UI_URL matches local", () => {
    process.env.CHAT_UI_URL = "http://127.0.0.1:18789";
    const urls = buildControlUiUrls(null);
    expect(urls).toHaveLength(1);
  });
});

// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createOnboardImageConfigHelpers } from "./image-config";

describe("onboard/image-config", () => {
  afterEach(() => {
    delete process.env.NEMOCLAW_PROXY_HOST;
    delete process.env.NEMOCLAW_PROXY_PORT;
  });

  it("derives sandbox inference config for anthropic and gemini providers", () => {
    const helpers = createOnboardImageConfigHelpers({
      encodeDockerJsonArg: (value: unknown) =>
        Buffer.from(JSON.stringify(value ?? {})).toString("base64"),
      getCredential: vi.fn(() => null),
      webSearch: {
        BRAVE_API_KEY_ENV: "BRAVE_API_KEY",
        buildWebSearchDockerConfig: vi.fn(() => "e30="),
      },
    });

    expect(helpers.getSandboxInferenceConfig("claude-sonnet", "anthropic-prod")).toEqual(
      expect.objectContaining({ providerKey: "anthropic", inferenceApi: "anthropic-messages" }),
    );
    expect(helpers.getSandboxInferenceConfig("gemini-2.5-flash", "gemini-api")).toEqual(
      expect.objectContaining({
        providerKey: "inference",
        inferenceCompat: { supportsStore: false },
      }),
    );
  });

  it("patches the staged Dockerfile with routing and messaging args", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "onboard-image-config-"));
    const dockerfilePath = path.join(tmpDir, "Dockerfile");
    fs.writeFileSync(
      dockerfilePath,
      [
        "ARG NEMOCLAW_MODEL=",
        "ARG NEMOCLAW_PROVIDER_KEY=",
        "ARG NEMOCLAW_PRIMARY_MODEL_REF=",
        "ARG CHAT_UI_URL=",
        "ARG NEMOCLAW_INFERENCE_BASE_URL=",
        "ARG NEMOCLAW_INFERENCE_API=",
        "ARG NEMOCLAW_INFERENCE_COMPAT_B64=",
        "ARG NEMOCLAW_BUILD_ID=",
        "ARG NEMOCLAW_PROXY_HOST=",
        "ARG NEMOCLAW_PROXY_PORT=",
        "ARG NEMOCLAW_WEB_CONFIG_B64=",
        "ARG NEMOCLAW_DISABLE_DEVICE_AUTH=0",
        "ARG NEMOCLAW_MESSAGING_CHANNELS_B64=",
        "ARG NEMOCLAW_MESSAGING_ALLOWED_IDS_B64=",
        "ARG NEMOCLAW_DISCORD_GUILDS_B64=",
      ].join("\n"),
    );
    process.env.NEMOCLAW_PROXY_HOST = "proxy.local";
    process.env.NEMOCLAW_PROXY_PORT = "3128";

    const helpers = createOnboardImageConfigHelpers({
      encodeDockerJsonArg: (value: unknown) =>
        Buffer.from(JSON.stringify(value ?? {})).toString("base64"),
      getCredential: vi.fn(() => "brave-key"),
      webSearch: {
        BRAVE_API_KEY_ENV: "BRAVE_API_KEY",
        buildWebSearchDockerConfig: vi.fn(() => "ZW5hYmxlZA=="),
      },
    });

    helpers.patchStagedDockerfile(
      dockerfilePath,
      "model-a",
      "http://127.0.0.1:18789",
      "build-1",
      "compatible-endpoint",
      "openai-responses",
      { fetchEnabled: true },
      ["telegram"],
      { telegram: ["1"] },
      { guild: { requireMention: true } },
    );

    const patched = fs.readFileSync(dockerfilePath, "utf-8");
    expect(patched).toContain("ARG NEMOCLAW_MODEL=model-a");
    expect(patched).toContain("ARG NEMOCLAW_PROVIDER_KEY=inference");
    expect(patched).toContain("ARG NEMOCLAW_INFERENCE_API=openai-responses");
    expect(patched).toContain("ARG NEMOCLAW_PROXY_HOST=proxy.local");
    expect(patched).toContain("ARG NEMOCLAW_PROXY_PORT=3128");
    expect(patched).toContain("ARG NEMOCLAW_DISABLE_DEVICE_AUTH=1");
  });
});

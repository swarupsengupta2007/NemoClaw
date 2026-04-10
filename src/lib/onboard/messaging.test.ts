// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

import { createOnboardMessagingHelpers } from "./messaging";

describe("onboard/messaging", () => {
  afterEach(() => {
    delete process.env.NEMOCLAW_NON_INTERACTIVE;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.DISCORD_BOT_TOKEN;
    delete process.env.SLACK_BOT_TOKEN;
  });

  it("detects configured messaging channels in non-interactive mode", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
    process.env.SLACK_BOT_TOKEN = "slack-token";
    const note = vi.fn();
    const helpers = createOnboardMessagingHelpers({
      getCredential: vi.fn(() => null),
      isNonInteractive: () => true,
      normalizeCredentialValue: (value: string | undefined) => value?.trim() || "",
      note,
      prompt: vi.fn(),
      saveCredential: vi.fn(),
      step: vi.fn(),
    });

    await expect(helpers.setupMessagingChannels()).resolves.toEqual(["telegram", "slack"]);
    expect(note).toHaveBeenCalledWith(
      "  [non-interactive] Messaging tokens detected: telegram, slack",
    );
  });

  it("exports the known messaging channel definitions", () => {
    const helpers = createOnboardMessagingHelpers({
      getCredential: vi.fn(() => null),
      isNonInteractive: () => true,
      normalizeCredentialValue: (value: string | undefined) => value?.trim() || "",
      note: vi.fn(),
      prompt: vi.fn(),
      saveCredential: vi.fn(),
      step: vi.fn(),
    });

    expect(helpers.MESSAGING_CHANNELS.map((channel) => channel.name)).toEqual([
      "telegram",
      "discord",
      "slack",
    ]);
  });
});

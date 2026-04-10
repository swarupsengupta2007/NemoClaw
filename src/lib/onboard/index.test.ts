// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("onboard/index", () => {
  it("wires the extracted onboarding helper modules together", () => {
    const source = fs.readFileSync(path.join(import.meta.dirname, "index.ts"), "utf-8");

    expect(source).toContain('const { createOnboardFlowHelpers } = require("./flow")');
    expect(source).toContain('const { createOnboardSandboxHelpers } = require("./sandbox")');
    expect(source).toContain('const { onboard } = createOnboardFlowHelpers({');
    expect(source).toContain('module.exports = {');
  });
});

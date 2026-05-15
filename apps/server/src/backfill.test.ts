import { describe, expect, it } from "vitest";
import { parseSubagentMeta } from "./backfill.js";

describe("parseSubagentMeta", () => {
  it("returns agentType and description from valid meta", () => {
    const result = parseSubagentMeta("a1234567", {
      agentType: "general-purpose",
      description: "Review the design",
    });
    expect(result).toEqual({
      agentType: "general-purpose",
      description: "Review the design",
    });
  });

  it("returns undefined fields when meta keys are missing", () => {
    expect(parseSubagentMeta("a1234567", {})).toEqual({});
  });

  it("ignores non-string field values", () => {
    expect(
      parseSubagentMeta("a1234567", { agentType: 123, description: null }),
    ).toEqual({});
  });

  it("returns null for non-object input", () => {
    expect(parseSubagentMeta("a1234567", null)).toBeNull();
    expect(parseSubagentMeta("a1234567", "string")).toBeNull();
    expect(parseSubagentMeta("a1234567", 42)).toBeNull();
  });
});

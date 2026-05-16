import { describe, expect, it } from "vitest";
import { omitUndefined } from "./util.js";

describe("omitUndefined", () => {
  it("strips keys whose value is undefined", () => {
    const result = omitUndefined({ a: 1, b: undefined, c: "x" });
    expect(result).toEqual({ a: 1, c: "x" });
    expect("b" in result).toBe(false);
  });

  it("returns an empty object when all values are undefined", () => {
    expect(omitUndefined({ a: undefined, b: undefined })).toEqual({});
  });

  it("returns the same object shape when no value is undefined", () => {
    const input = { a: 1, b: "x", c: false, d: null };
    expect(omitUndefined(input)).toEqual(input);
  });

  it("preserves falsy non-undefined values", () => {
    const result = omitUndefined({ zero: 0, empty: "", nope: false, missing: undefined });
    expect(result).toEqual({ zero: 0, empty: "", nope: false });
  });
});

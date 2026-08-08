import { describe, it, expect } from "vitest";
import { parsePageParam } from "../pagination";

describe("parsePageParam", () => {
  it("returns 0 when the param is missing", () => {
    expect(parsePageParam(undefined)).toBe(0);
  });

  it("parses a valid positive integer", () => {
    expect(parsePageParam("3")).toBe(3);
    expect(parsePageParam("0")).toBe(0);
  });

  it("falls back to 0 for non-numeric input instead of NaN", () => {
    expect(parsePageParam("abc")).toBe(0);
    expect(parsePageParam("")).toBe(0);
    expect(parsePageParam("NaN")).toBe(0);
  });

  it("falls back to 0 for negative input", () => {
    expect(parsePageParam("-1")).toBe(0);
    expect(parsePageParam("-100")).toBe(0);
  });

  it("falls back to 0 for non-finite input", () => {
    expect(parsePageParam("Infinity")).toBe(0);
  });

  it("truncates a fractional string via parseInt semantics", () => {
    expect(parsePageParam("2.9")).toBe(2);
  });

  it("parses the leading integer out of a mixed string", () => {
    expect(parsePageParam("2abc")).toBe(2);
  });
});

import { describe, it, expect } from "vitest";
import { parsePositiveInt } from "../env";

describe("parsePositiveInt", () => {
  it("returns the fallback when the value is undefined", () => {
    expect(parsePositiveInt(undefined, 42)).toBe(42);
  });

  it("parses a valid positive integer string", () => {
    expect(parsePositiveInt("10", 42)).toBe(10);
  });

  it("returns the fallback for non-numeric input instead of NaN", () => {
    expect(parsePositiveInt("abc", 42)).toBe(42);
    expect(parsePositiveInt("", 42)).toBe(42);
    expect(parsePositiveInt("NaN", 42)).toBe(42);
  });

  it("returns the fallback for zero or negative input", () => {
    expect(parsePositiveInt("0", 42)).toBe(42);
    expect(parsePositiveInt("-5", 42)).toBe(42);
  });

  it("returns the fallback for non-finite input", () => {
    expect(parsePositiveInt("Infinity", 42)).toBe(42);
  });

  it("truncates a fractional string via parseInt semantics", () => {
    expect(parsePositiveInt("3.9", 42)).toBe(3);
  });

  it("accepts a valid positive number directly", () => {
    expect(parsePositiveInt(10, 42)).toBe(10);
  });

  it("truncates a fractional number", () => {
    expect(parsePositiveInt(3.9, 42)).toBe(3);
  });

  it("returns the fallback for NaN, zero, negative, or non-finite numbers", () => {
    expect(parsePositiveInt(NaN, 42)).toBe(42);
    expect(parsePositiveInt(0, 42)).toBe(42);
    expect(parsePositiveInt(-5, 42)).toBe(42);
    expect(parsePositiveInt(Infinity, 42)).toBe(42);
  });
});

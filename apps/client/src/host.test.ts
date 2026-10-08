import { describe, expect, test } from "vitest";
import { newerVersion } from "./host.ts";

describe("the Android update check (host.ts)", () => {
  test("compares x.y.z numerically, not as text", () => {
    expect(newerVersion("0.2.1", "0.2.0")).toBe(true);
    expect(newerVersion("0.10.0", "0.9.9")).toBe(true);
    expect(newerVersion("1.0.0", "0.99.99")).toBe(true);
  });

  test("the same or an older version isn't an update", () => {
    expect(newerVersion("0.2.0", "0.2.0")).toBe(false);
    expect(newerVersion("0.1.9", "0.2.0")).toBe(false);
  });
});

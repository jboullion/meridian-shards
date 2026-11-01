import { describe, expect, it } from "vitest";
import { buildErrors } from "./build.ts";

describe("buildErrors", () => {
  it("finds Kod compile errors that nmake lets through", () => {
    const out = [
      "Compiling util\\questdefs.kod",
      "monster.kod(120): warning: unused local",
      "object\\item\\food.kod(42): error: syntax error",
      "util\\gone.kod: error: unknown class",
      "NMAKE : fatal error U1077: 'bc' : return code '0xc0000005'",
      "Copying kodbase.txt and kod include files",
    ].join("\r\n");
    expect(buildErrors(out)).toEqual([
      "object\\item\\food.kod(42): error: syntax error",
      "util\\gone.kod: error: unknown class",
      "NMAKE : fatal error U1077: 'bc' : return code '0xc0000005'",
    ]);
  });

  it("passes a clean build, warnings included", () => {
    expect(buildErrors("blakston.khd(10): warning: x\nCopying kodbase.txt and kod include files\n")).toEqual([]);
  });
});

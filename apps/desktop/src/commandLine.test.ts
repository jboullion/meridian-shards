import { describe, expect, test } from "vitest";
import { parseCommandLine, serverFromCommandLine } from "./commandLine.ts";

describe("the original's command line (config.c ConfigOverride)", () => {
  test("/H /P /U /W /Q, with or without the colon, either case", () => {
    expect(parseCommandLine(["/U:shardbot", "/w:secret", "/H:localhost", "-P5959", "/q"], true)).toEqual({
      username: "shardbot", password: "secret", host: "localhost", port: 5959, quickstart: true,
    });
  });

  test("a zero port is ignored; Chromium's switches and paths are not switches", () => {
    expect(parseCommandLine(["/P:abc", "--devtools", "--remote-debugging-port=9222"], true)).toEqual({ quickstart: false });
    // "/" starts a path off Windows
    expect(parseCommandLine(["/home/me/app", "-Ushardbot"], false)).toEqual({ username: "shardbot", quickstart: false });
  });

  test("/H picks a listed server by host (and port), else https (http for localhost)", () => {
    const listed = [{ origin: "https://35-206-75-121.sslip.io" }, { origin: "http://localhost:5173" }, { origin: "http://localhost:8080" }];
    expect(serverFromCommandLine({ host: "35-206-75-121.sslip.io", quickstart: false }, listed)).toBe("https://35-206-75-121.sslip.io");
    expect(serverFromCommandLine({ host: "localhost", port: 8080, quickstart: false }, listed)).toBe("http://localhost:8080");
    expect(serverFromCommandLine({ host: "localhost", port: 9000, quickstart: false }, listed)).toBe("http://localhost:9000");
    expect(serverFromCommandLine({ host: "example.org", quickstart: false }, listed)).toBe("https://example.org");
    expect(serverFromCommandLine({ host: "http://example.org:81/x", quickstart: false }, listed)).toBe("http://example.org:81");
    expect(serverFromCommandLine({ quickstart: false }, listed)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("keeps an in-app path", () => {
    expect(safeNext("/applications/new")).toBe("/applications/new");
  });

  it("rejects protocol-relative paths, backslashes, and absolute URLs", () => {
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("/applications/\\evil")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("")).toBe("/");
    expect(safeNext(undefined)).toBe("/");
  });
});

import { describe, expect, test } from "vitest";
import { FINENESS } from "@shards/formats";
import { annotationAt, annotationRadius, loadAnnotations, saveAnnotations, type AnnotationStore } from "./annotations.ts";

const store = (): AnnotationStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};

describe("map annotations (annotate.c)", () => {
  test("kept per server and room checksum; an empty list removes the entry", () => {
    const s = store();
    saveAnnotations(s, "ws://a", -5, [{ x: 1, y: 2, text: "chest" }]);
    expect(loadAnnotations(s, "ws://a", -5)).toEqual([{ x: 1, y: 2, text: "chest" }]);
    expect(loadAnnotations(s, "ws://a", 7)).toEqual([]);
    expect(loadAnnotations(s, "ws://b", -5)).toEqual([]);
    saveAnnotations(s, "ws://a", -5, []);
    expect(s.data.size).toBe(0);
    s.data.set("shards.annotations.ws://a.1", "not json");
    expect(loadAnnotations(s, "ws://a", 1)).toEqual([]);
  });

  test("MapAnnotationClick finds one within a square of 2 * FINENESS", () => {
    const list = [{ x: 5000, y: 5000, text: "a" }, { x: 9000, y: 9000, text: "b" }];
    expect(annotationAt(list, 5000 + FINENESS, 5000 - FINENESS)).toBe(0);
    expect(annotationAt(list, 5000 + FINENESS + 1, 5000)).toBe(-1);
    expect(annotationAt(list, 8500, 9500)).toBe(1);
  });

  test("drawn at least 14 pixels across", () => {
    expect(annotationRadius(0.001)).toBe(7);
    expect(annotationRadius(0.01)).toBe(Math.trunc(2 * FINENESS * 0.01 / 2));
  });
});

import { describe, expect, it } from "vitest";

import { asyncIterableStream, openClawStreamToAsyncIterable } from "./stream.js";

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}

describe("Effect stream bridge", () => {
  it("round-trips async iterable values", async () => {
    async function* source() {
      yield "alpha";
      yield "beta";
    }

    await expect(
      collect(openClawStreamToAsyncIterable(asyncIterableStream(source()))),
    ).resolves.toEqual(["alpha", "beta"]);
  });

  it("maps async iterable failures before rethrowing them", async () => {
    const original = new Error("source failed");
    const mapped = new Error("mapped source failed");
    async function* source() {
      yield "alpha";
      throw original;
    }

    await expect(
      collect(openClawStreamToAsyncIterable(asyncIterableStream(source(), () => mapped))),
    ).rejects.toBe(mapped);
  });
});

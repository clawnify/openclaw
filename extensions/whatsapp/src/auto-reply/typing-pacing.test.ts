import { describe, expect, it } from "vitest";
import {
  computeTypingDelayMs,
  DEFAULT_TYPING_PACING,
  resolveWhatsAppTypingPacing,
  type TypingPacing,
} from "./typing-pacing.js";

const on: TypingPacing = { ...DEFAULT_TYPING_PACING, enabled: true, jitter: 0 };

describe("computeTypingDelayMs", () => {
  it("returns 0 when disabled (default behavior unchanged)", () => {
    expect(computeTypingDelayMs(500, { ...on, enabled: false })).toBe(0);
  });

  it("scales with length, clamped to [minMs, maxMs]", () => {
    // short -> floored at minMs
    expect(computeTypingDelayMs(1, on, 0.5)).toBe(on.minMs);
    // very long -> capped at maxMs
    expect(computeTypingDelayMs(100000, on, 0.5)).toBe(on.maxMs);
    // mid -> base = len/cps*1000; 60 chars @20cps = 3000ms
    expect(computeTypingDelayMs(60, on, 0.5)).toBe(3000);
  });

  it("applies symmetric jitter deterministically from the random arg", () => {
    const p = { ...on, jitter: 0.5 };
    const base = 3000; // 60 chars @20cps
    expect(computeTypingDelayMs(60, p, 0.5)).toBe(base); // random 0.5 -> factor 0
    expect(computeTypingDelayMs(60, p, 1)).toBe(base + base * 0.5); // +50%
    expect(computeTypingDelayMs(60, p, 0)).toBe(base - base * 0.5); // -50%
  });

  it("never returns negative", () => {
    expect(computeTypingDelayMs(60, { ...on, jitter: 5 }, 0)).toBeGreaterThanOrEqual(0);
  });
});

describe("resolveWhatsAppTypingPacing", () => {
  it("is disabled by default", () => {
    expect(resolveWhatsAppTypingPacing({}).enabled).toBe(false);
  });

  it("enables on truthy env values", () => {
    for (const v of ["1", "true", "yes", "on", "ON"]) {
      expect(resolveWhatsAppTypingPacing({ OPENCLAW_WHATSAPP_TYPING_PACING: v }).enabled).toBe(true);
    }
  });

  it("reads numeric overrides, ignoring invalid ones", () => {
    const p = resolveWhatsAppTypingPacing({
      OPENCLAW_WHATSAPP_TYPING_PACING: "1",
      OPENCLAW_WHATSAPP_TYPING_CPS: "12",
      OPENCLAW_WHATSAPP_TYPING_MAX_MS: "bogus",
    });
    expect(p.cps).toBe(12);
    expect(p.maxMs).toBe(DEFAULT_TYPING_PACING.maxMs);
  });
});

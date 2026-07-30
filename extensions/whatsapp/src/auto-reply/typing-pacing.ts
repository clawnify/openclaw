/**
 * Human-like reply pacing. By default WhatsApp replies are dispatched the instant
 * the agent finishes — chunks arrive back-to-back with no typing time, which reads
 * as automated. When enabled, this inserts a "composing" indicator plus a bounded,
 * jittered delay (roughly proportional to the reply length) before each chunk.
 *
 * Opt-in via OPENCLAW_WHATSAPP_TYPING_PACING so default behavior is unchanged;
 * deployments enable it the same way as the other OPENCLAW_WHATSAPP_* gates.
 */

export type TypingPacing = {
  enabled: boolean;
  /** Simulated typing speed (characters per second). */
  cps: number;
  /** Floor so even a short reply pauses briefly. */
  minMs: number;
  /** Ceiling so a long reply never stalls the conversation. */
  maxMs: number;
  /** Fractional +/- randomization applied to the computed delay (0..1). */
  jitter: number;
};

export const DEFAULT_TYPING_PACING: TypingPacing = {
  enabled: false,
  cps: 20,
  minMs: 700,
  maxMs: 6000,
  jitter: 0.3,
};

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined) {
    return fallback;
  }
  const n = Number(raw.trim());
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function isEnvTruthy(raw: string | undefined): boolean {
  if (raw === undefined) {
    return false;
  }
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function resolveWhatsAppTypingPacing(env: NodeJS.ProcessEnv = process.env): TypingPacing {
  const enabled = isEnvTruthy(env.OPENCLAW_WHATSAPP_TYPING_PACING);
  return {
    enabled,
    cps: parsePositiveNumber(env.OPENCLAW_WHATSAPP_TYPING_CPS, DEFAULT_TYPING_PACING.cps),
    minMs: parsePositiveNumber(env.OPENCLAW_WHATSAPP_TYPING_MIN_MS, DEFAULT_TYPING_PACING.minMs),
    maxMs: parsePositiveNumber(env.OPENCLAW_WHATSAPP_TYPING_MAX_MS, DEFAULT_TYPING_PACING.maxMs),
    jitter: DEFAULT_TYPING_PACING.jitter,
  };
}

/**
 * Delay before a chunk of `textLength` characters. Pure and deterministic given
 * `random` (0..1), so it is unit-testable without timers. Returns 0 when disabled.
 */
export function computeTypingDelayMs(
  textLength: number,
  pacing: TypingPacing,
  random: number = Math.random(),
): number {
  if (!pacing.enabled) {
    return 0;
  }
  const base = (Math.max(0, textLength) / pacing.cps) * 1000;
  const clamped = Math.min(pacing.maxMs, Math.max(pacing.minMs, base));
  const jitterSpan = clamped * pacing.jitter;
  // random in [0,1) -> factor in [-1, 1)
  const delay = clamped + jitterSpan * (random * 2 - 1);
  return Math.round(Math.max(0, delay));
}

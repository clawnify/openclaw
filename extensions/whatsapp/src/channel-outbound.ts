import {
  createMessageReceiptFromOutboundResults,
  defineChannelMessageAdapter,
  type ChannelMessageSendResult,
} from "openclaw/plugin-sdk/channel-message";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { chunkText } from "openclaw/plugin-sdk/reply-chunking";
import { createWhatsAppOutboundBase } from "./outbound-base.js";
import { normalizeWhatsAppPayloadTextPreservingIndentation } from "./outbound-media-contract.js";
import { resolveWhatsAppOutboundTarget } from "./resolve-outbound-target.js";
import { getWhatsAppRuntime } from "./runtime.js";
import { sendMessageWhatsApp, sendPollWhatsApp } from "./send.js";

export function normalizeWhatsAppChannelPayloadText(text: string | undefined): string {
  return normalizeWhatsAppPayloadTextPreservingIndentation(text);
}

function normalizeWhatsAppChannelSendText(text: string | undefined): string {
  const normalized = normalizeWhatsAppChannelPayloadText(text);
  return normalized.trim() ? normalized : "";
}

/**
 * Outbound target policy, read from the plugin-scoped config bag
 * `plugins.entries.whatsapp.config.outboundOpen`.
 *
 * Why not `channels.whatsapp.outboundPolicy`: `channels.whatsapp` is validated
 * with `.strict()`, so an unknown channel key is rejected. `plugins.entries.<id>.config`
 * is a `z.record(z.unknown())` passthrough, so the flag validates without a
 * channel-schema change and is read from the resolved config here.
 *
 * When true the agent may send to any number; `dmPolicy`/`allowFrom` still gate
 * who can trigger a reply, so inbound stays restricted. Default: allowlist.
 */
function resolveWhatsAppOutboundPolicy(cfg: OpenClawConfig | undefined): "allowlist" | "open" {
  const pluginConfig = cfg?.plugins?.entries?.whatsapp?.config as
    | { outboundOpen?: unknown }
    | undefined;
  return pluginConfig?.outboundOpen === true ? "open" : "allowlist";
}

export const whatsappChannelOutbound = {
  ...createWhatsAppOutboundBase({
    chunker: chunkText,
    sendMessageWhatsApp: async (to, text, options) =>
      await sendMessageWhatsApp(to, text, {
        ...options,
        preserveLeadingWhitespace: true,
      }),
    sendPollWhatsApp,
    shouldLogVerbose: () => getWhatsAppRuntime().logging.shouldLogVerbose(),
    resolveTarget: ({ to, allowFrom, mode, cfg }) =>
      resolveWhatsAppOutboundTarget({
        to,
        allowFrom,
        mode,
        outboundPolicy: resolveWhatsAppOutboundPolicy(cfg),
      }),
    normalizeText: normalizeWhatsAppChannelSendText,
  }),
  sendTextOnlyErrorPayloads: true,
  normalizePayload: ({ payload }: { payload: { text?: string } }) => ({
    ...payload,
    text: normalizeWhatsAppChannelPayloadText(payload.text),
  }),
};

function toWhatsAppMessageSendResult(
  result: Awaited<ReturnType<NonNullable<typeof whatsappChannelOutbound.sendText>>>,
  replyToId?: string | null,
): ChannelMessageSendResult {
  const source = result as typeof result & { toJid?: string };
  const receipt =
    result.receipt ??
    createMessageReceiptFromOutboundResults({
      results: result.messageId
        ? [
            {
              channel: "whatsapp",
              messageId: result.messageId,
              toJid: source.toJid,
            },
          ]
        : [],
      kind: "text",
      ...(replyToId ? { replyToId } : {}),
    });
  return {
    messageId: result.messageId || receipt.primaryPlatformMessageId,
    receipt,
  };
}

export const whatsappMessageAdapter = defineChannelMessageAdapter({
  id: "whatsapp",
  durableFinal: {
    capabilities: {
      text: true,
      replyTo: true,
      messageSendingHooks: true,
    },
  },
  send: {
    text: async (ctx) =>
      toWhatsAppMessageSendResult(
        await whatsappChannelOutbound.sendText!({
          ...ctx,
        }),
        ctx.replyToId,
      ),
  },
});

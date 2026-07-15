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
 * Outbound target policy, read from `channels.whatsapp.outboundOpen` (a
 * first-class channel setting alongside `dmPolicy`/`groupPolicy`/`allowFrom`,
 * with the usual per-account override). When true the agent may send to any
 * number; `dmPolicy`/`allowFrom` still gate who can trigger a reply, so inbound
 * stays restricted. Default false (restricted). The field is declared in the
 * WhatsApp config schema, so the plugin's generated `channelConfigs` schema
 * validates it and the gateway accepts the config write.
 */
function resolveWhatsAppOutboundPolicy(
  cfg: OpenClawConfig | undefined,
  accountId: string | null | undefined,
): "allowlist" | "open" {
  const wa = cfg?.channels?.whatsapp;
  const account =
    accountId && wa?.accounts && typeof wa.accounts === "object"
      ? wa.accounts[accountId]
      : undefined;
  const open = account?.outboundOpen ?? wa?.outboundOpen;
  return open === true ? "open" : "allowlist";
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
    resolveTarget: ({ to, allowFrom, mode, cfg, accountId }) =>
      resolveWhatsAppOutboundTarget({
        to,
        allowFrom,
        mode,
        outboundPolicy: resolveWhatsAppOutboundPolicy(cfg, accountId),
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

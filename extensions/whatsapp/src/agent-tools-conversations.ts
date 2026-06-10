import type { ChannelAgentTool } from "openclaw/plugin-sdk/channel-contract";
import { getRuntimeConfig } from "openclaw/plugin-sdk/runtime-config-snapshot";
import { Type } from "typebox";
import { getActiveWebListener, resolveWebAccountId } from "./active-listener.js";
import type { ChatSummary, MessageSummary } from "./inbound/conversation-store.js";
import type { ActiveWebListener } from "./inbound/types.js";

// Interim build gate, mirroring the group tools: conversation reading is opt-in
// via OPENCLAW_WHATSAPP_CONVERSATIONS rather than a channels.whatsapp.actions
// config flag (stock core's strict zod schema would reject a new key there).
// Reading a user's full chat list + message history is more sensitive than the
// group actions, so it gets its OWN explicit gate — enabling groups must not
// silently grant history access.
function areWhatsAppConversationToolsEnabled(): boolean {
  const raw = process.env.OPENCLAW_WHATSAPP_CONVERSATIONS;
  return raw === "1" || raw === "true";
}

function requireConversationCapableListener(accountIdArg: unknown): ActiveWebListener {
  if (!areWhatsAppConversationToolsEnabled()) {
    throw new Error(
      "WhatsApp conversation tools are disabled. Set OPENCLAW_WHATSAPP_CONVERSATIONS=1 to enable them.",
    );
  }
  const cfg = getRuntimeConfig();
  const accountId = resolveWebAccountId({
    cfg,
    accountId: typeof accountIdArg === "string" ? accountIdArg : null,
  });
  const listener = getActiveWebListener(accountId);
  if (!listener) {
    throw new Error(`WhatsApp is not linked (account: ${accountId}). Link it first, then retry.`);
  }
  return listener;
}

function readChatJid(value: unknown): string {
  const jid = typeof value === "string" ? value.trim() : "";
  if (!jid) {
    throw new Error("jid is required (a chat JID from whatsapp_list_chats, e.g. 1555...@s.whatsapp.net).");
  }
  return jid;
}

function formatTimestamp(unixSeconds: number): string {
  if (!unixSeconds) {
    return "unknown time";
  }
  return new Date(unixSeconds * 1000).toISOString();
}

function formatChatLine(chat: ChatSummary): string {
  const label = chat.name ? `${chat.name} (${chat.jid})` : chat.jid;
  const unread = chat.unreadCount > 0 ? ` — ${chat.unreadCount} unread` : "";
  const preview = chat.lastMessageText ? ` — last: ${chat.lastMessageText}` : "";
  return `${label}${unread}${preview}`;
}

function formatMessageLine(msg: MessageSummary): string {
  const who = msg.fromMe ? "me" : (msg.sender ?? "unknown");
  const body = msg.text ?? msg.media ?? "";
  return `[${formatTimestamp(msg.timestamp)}] ${who}: ${body}`;
}

function createWhatsAppListChatsTool(): ChannelAgentTool {
  return {
    label: "WhatsApp List Chats",
    name: "whatsapp_list_chats",
    description:
      "List the WhatsApp conversations currently known to the agent, most recent first. " +
      "Reads a live in-memory mirror (recent window only — not the full archive). " +
      "Use the returned JID with whatsapp_read_conversation to inspect a chat.",
    parameters: Type.Object({
      accountId: Type.Optional(Type.String()),
    }),
    execute: async (_toolCallId, args) => {
      const { accountId } = args as { accountId?: string };
      const listener = requireConversationCapableListener(accountId);
      const chats = await listener.listChats();
      const text = chats.length
        ? chats.map(formatChatLine).join("\n")
        : "No conversations are mirrored yet. They populate as WhatsApp syncs history and new messages arrive.";
      return {
        content: [{ type: "text", text }],
        details: { count: chats.length, chats },
      };
    },
  };
}

function createWhatsAppReadConversationTool(): ChannelAgentTool {
  return {
    label: "WhatsApp Read Conversation",
    name: "whatsapp_read_conversation",
    description:
      "Read recent messages of a WhatsApp conversation (oldest to newest) from the in-memory " +
      "mirror. Media messages appear as placeholders like <media:image>. Pass a JID from " +
      "whatsapp_list_chats.",
    parameters: Type.Object({
      jid: Type.String({
        description: "Chat JID, e.g. 15551234567@s.whatsapp.net (direct) or 1203...@g.us (group).",
      }),
      limit: Type.Optional(
        Type.Number({ description: "Max messages to return (default 30, capped at 50)." }),
      ),
      accountId: Type.Optional(Type.String()),
    }),
    execute: async (_toolCallId, args) => {
      const { jid, limit, accountId } = args as {
        jid?: unknown;
        limit?: number;
        accountId?: string;
      };
      const chatJid = readChatJid(jid);
      const listener = requireConversationCapableListener(accountId);
      const messages = await listener.readConversation(
        chatJid,
        typeof limit === "number" ? limit : undefined,
      );
      const text = messages.length
        ? messages.map(formatMessageLine).join("\n")
        : `No mirrored messages for ${chatJid}. The mirror holds a recent window only.`;
      return {
        content: [{ type: "text", text }],
        details: { jid: chatJid, count: messages.length, messages },
      };
    },
  };
}

/**
 * WhatsApp conversation read tools, opt-in via OPENCLAW_WHATSAPP_CONVERSATIONS.
 * Returned only when enabled, so disabled installs don't advertise tools the
 * agent can't use. Each tool re-checks the gate + requires an active listener.
 */
export function createWhatsAppConversationTools(): ChannelAgentTool[] {
  if (!areWhatsAppConversationToolsEnabled()) {
    return [];
  }
  return [createWhatsAppListChatsTool(), createWhatsAppReadConversationTool()];
}

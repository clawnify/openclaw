import type { Chat, ChatUpdate, WAMessage } from "baileys";
import { extractMediaPlaceholder, extractText } from "./extract.js";

/**
 * In-memory mirror of WhatsApp conversations.
 *
 * Baileys exposes no on-demand query API — chat lists and message history
 * exist ONLY as streamed events (`messaging-history.set`, `chats.upsert`,
 * `chats.update`, `messages.upsert`). To let the agent list and inspect
 * conversations we capture those events here, in RAM only. Nothing is ever
 * written to disk: the mirror is rebuilt from WhatsApp's on-connect history
 * sync on every reconnect and is gone on process restart.
 *
 * Both maps are bounded so a busy account can't grow memory without limit.
 */

const MAX_CHATS = 500;
const MAX_MESSAGES_PER_CHAT = 50;
const STATUS_BROADCAST_JID = "status@broadcast";

export type ChatSummary = {
  jid: string;
  name?: string;
  unreadCount: number;
  /** Unix seconds of the last known activity in the chat. */
  lastMessageTimestamp: number;
  lastMessageText?: string;
};

export type MessageSummary = {
  id?: string;
  fromMe: boolean;
  /** Sender JID: the participant for groups, the chat JID for direct chats. */
  sender?: string;
  /** Unix seconds. */
  timestamp: number;
  text?: string;
  /** Placeholder like `<media:image>` when the message carries non-text content. */
  media?: string;
};

type EmitterLike = {
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  off?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

/** Baileys timestamps are `number | Long`; normalize to a plain number. */
function toNumber(value: unknown): number {
  if (value == null) {
    return 0;
  }
  if (typeof value === "number") {
    return value;
  }
  const maybeLong = value as { toNumber?: () => number };
  if (typeof maybeLong.toNumber === "function") {
    return maybeLong.toNumber();
  }
  const coerced = Number(value);
  return Number.isFinite(coerced) ? coerced : 0;
}

function chatDisplayName(chat: Partial<Chat>): string | undefined {
  const name = (chat.name ?? chat.displayName ?? "").trim();
  return name || undefined;
}

function toMessageSummary(msg: WAMessage): MessageSummary | null {
  const text = extractText(msg.message ?? undefined);
  const media = extractMediaPlaceholder(msg.message ?? undefined);
  if (!text && !media) {
    // Receipt / typing / protocol envelope — no user-visible content.
    return null;
  }
  return {
    id: msg.key?.id ?? undefined,
    fromMe: Boolean(msg.key?.fromMe),
    sender: msg.key?.participant ?? msg.key?.remoteJid ?? undefined,
    timestamp: toNumber(msg.messageTimestamp),
    text: text ?? undefined,
    media: media ?? undefined,
  };
}

export class ConversationStore {
  private readonly chats = new Map<string, ChatSummary>();
  private readonly messages = new Map<string, MessageSummary[]>();

  ingestHistory(set: { chats?: Chat[]; messages?: WAMessage[] }): void {
    for (const chat of set.chats ?? []) {
      this.upsertChat(chat);
    }
    for (const msg of set.messages ?? []) {
      this.appendMessage(msg);
    }
  }

  ingestChatsUpsert(chats: Chat[]): void {
    for (const chat of chats ?? []) {
      this.upsertChat(chat);
    }
  }

  ingestChatUpdate(updates: ChatUpdate[]): void {
    for (const update of updates ?? []) {
      const jid = update.id;
      if (!jid) {
        continue;
      }
      const existing = this.chats.get(jid);
      if (!existing) {
        this.upsertChat(update as Chat);
        continue;
      }
      const name = chatDisplayName(update);
      if (name) {
        existing.name = name;
      }
      if (update.unreadCount != null) {
        existing.unreadCount = Math.max(0, toNumber(update.unreadCount));
      }
      const ts = toNumber(update.conversationTimestamp);
      if (ts) {
        existing.lastMessageTimestamp = Math.max(existing.lastMessageTimestamp, ts);
      }
    }
  }

  ingestMessages(upsert: { messages?: WAMessage[] }): void {
    for (const msg of upsert.messages ?? []) {
      this.appendMessage(msg);
    }
  }

  listChats(): ChatSummary[] {
    return [...this.chats.values()]
      .sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp)
      .map((chat) => ({ ...chat }));
  }

  readConversation(jid: string, limit = 30): MessageSummary[] {
    const buffer = this.messages.get(jid) ?? [];
    const count = Math.max(1, Math.min(limit, MAX_MESSAGES_PER_CHAT));
    return buffer.slice(-count).map((msg) => ({ ...msg }));
  }

  /** Subscribe the store to a socket's event emitter. Returns a detacher. */
  bind(ev: EmitterLike): () => void {
    const detachers = [
      this.attach(ev, "messaging-history.set", (payload) =>
        this.ingestHistory(payload as { chats?: Chat[]; messages?: WAMessage[] }),
      ),
      this.attach(ev, "chats.upsert", (payload) => this.ingestChatsUpsert(payload as Chat[])),
      this.attach(ev, "chats.update", (payload) => this.ingestChatUpdate(payload as ChatUpdate[])),
      this.attach(ev, "messages.upsert", (payload) =>
        this.ingestMessages(payload as { messages?: WAMessage[] }),
      ),
    ];
    return () => {
      for (const detach of detachers) {
        detach();
      }
    };
  }

  private attach(
    ev: EmitterLike,
    event: string,
    handler: (payload: unknown) => void,
  ): () => void {
    const listener = (...args: unknown[]) => handler(args[0]);
    ev.on(event, listener);
    return () => {
      if (typeof ev.off === "function") {
        ev.off(event, listener);
      } else if (typeof ev.removeListener === "function") {
        ev.removeListener(event, listener);
      }
    };
  }

  private upsertChat(chat: Partial<Chat>): void {
    const jid = chat.id;
    if (!jid || jid === STATUS_BROADCAST_JID) {
      return;
    }
    const existing = this.chats.get(jid);
    const ts = toNumber(chat.conversationTimestamp);
    this.chats.set(jid, {
      jid,
      name: chatDisplayName(chat) ?? existing?.name,
      unreadCount:
        chat.unreadCount != null
          ? Math.max(0, toNumber(chat.unreadCount))
          : (existing?.unreadCount ?? 0),
      lastMessageTimestamp: Math.max(existing?.lastMessageTimestamp ?? 0, ts),
      lastMessageText: existing?.lastMessageText,
    });
    this.evictChatsIfNeeded();
  }

  private appendMessage(msg: WAMessage): void {
    const jid = msg.key?.remoteJid;
    if (!jid || jid === STATUS_BROADCAST_JID) {
      return;
    }
    const summary = toMessageSummary(msg);
    if (!summary) {
      return;
    }
    const buffer = this.messages.get(jid) ?? [];
    if (summary.id && buffer.some((existing) => existing.id === summary.id)) {
      return;
    }
    buffer.push(summary);
    buffer.sort((a, b) => a.timestamp - b.timestamp);
    if (buffer.length > MAX_MESSAGES_PER_CHAT) {
      buffer.splice(0, buffer.length - MAX_MESSAGES_PER_CHAT);
    }
    this.messages.set(jid, buffer);
    this.touchChatFromMessage(jid, summary);
  }

  private touchChatFromMessage(jid: string, summary: MessageSummary): void {
    const preview = summary.text ?? summary.media;
    const existing = this.chats.get(jid);
    if (!existing) {
      this.chats.set(jid, {
        jid,
        unreadCount: 0,
        lastMessageTimestamp: summary.timestamp,
        lastMessageText: preview,
      });
      this.evictChatsIfNeeded();
      return;
    }
    if (summary.timestamp >= existing.lastMessageTimestamp) {
      existing.lastMessageTimestamp = summary.timestamp;
      existing.lastMessageText = preview;
    }
  }

  private evictChatsIfNeeded(): void {
    if (this.chats.size <= MAX_CHATS) {
      return;
    }
    const oldestFirst = [...this.chats.values()].sort(
      (a, b) => a.lastMessageTimestamp - b.lastMessageTimestamp,
    );
    const dropCount = this.chats.size - MAX_CHATS;
    for (let i = 0; i < dropCount; i++) {
      const victim = oldestFirst[i];
      this.chats.delete(victim.jid);
      this.messages.delete(victim.jid);
    }
  }
}

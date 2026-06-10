import type { Chat, WAMessage } from "baileys";
import { describe, expect, it } from "vitest";
import { ConversationStore } from "./conversation-store.js";

function chat(id: string, overrides: Partial<Chat> = {}): Chat {
  return { id, conversationTimestamp: 1000, ...overrides } as Chat;
}

function textMessage(
  remoteJid: string,
  text: string,
  opts: { id?: string; ts?: number; fromMe?: boolean; participant?: string } = {},
): WAMessage {
  return {
    key: {
      remoteJid,
      fromMe: opts.fromMe ?? false,
      id: opts.id ?? `m-${text}`,
      participant: opts.participant,
    },
    message: { conversation: text },
    messageTimestamp: opts.ts ?? 1000,
  } as WAMessage;
}

describe("ConversationStore", () => {
  it("lists chats most-recent-first with metadata", () => {
    const store = new ConversationStore();
    store.ingestHistory({
      chats: [
        chat("a@s.whatsapp.net", { name: "Alice", conversationTimestamp: 100, unreadCount: 2 }),
        chat("b@s.whatsapp.net", { name: "Bob", conversationTimestamp: 300 }),
        chat("c@s.whatsapp.net", { name: "Carol", conversationTimestamp: 200 }),
      ],
    });

    const chats = store.listChats();
    expect(chats.map((c) => c.jid)).toEqual([
      "b@s.whatsapp.net",
      "c@s.whatsapp.net",
      "a@s.whatsapp.net",
    ]);
    expect(chats[2]).toMatchObject({ name: "Alice", unreadCount: 2 });
  });

  it("reads a conversation oldest-to-newest and updates the chat preview", () => {
    const store = new ConversationStore();
    store.ingestHistory({ chats: [chat("a@s.whatsapp.net", { name: "Alice" })] });
    store.ingestMessages({
      messages: [
        textMessage("a@s.whatsapp.net", "first", { id: "1", ts: 10 }),
        textMessage("a@s.whatsapp.net", "second", { id: "2", ts: 20, fromMe: true }),
      ],
    });

    const messages = store.readConversation("a@s.whatsapp.net");
    expect(messages.map((m) => m.text)).toEqual(["first", "second"]);
    expect(messages[1]).toMatchObject({ fromMe: true });

    const alice = store.listChats().find((c) => c.jid === "a@s.whatsapp.net");
    expect(alice?.lastMessageText).toBe("second");
    expect(alice?.lastMessageTimestamp).toBe(20);
  });

  it("creates a chat entry for a DM seen only via messages", () => {
    const store = new ConversationStore();
    store.ingestMessages({ messages: [textMessage("new@s.whatsapp.net", "hi", { ts: 50 })] });
    expect(store.listChats().map((c) => c.jid)).toEqual(["new@s.whatsapp.net"]);
    expect(store.readConversation("new@s.whatsapp.net")).toHaveLength(1);
  });

  it("represents media messages as placeholders, text-first", () => {
    const store = new ConversationStore();
    const imageMsg = {
      key: { remoteJid: "a@s.whatsapp.net", id: "img", fromMe: false },
      message: { imageMessage: { caption: "" } },
      messageTimestamp: 5,
    } as unknown as WAMessage;
    store.ingestMessages({ messages: [imageMsg] });
    expect(store.readConversation("a@s.whatsapp.net")[0].media).toBe("<media:image>");
  });

  it("skips status broadcasts and contentless messages", () => {
    const store = new ConversationStore();
    store.ingestMessages({
      messages: [
        textMessage("status@broadcast", "ignored", { ts: 1 }),
        { key: { remoteJid: "a@s.whatsapp.net", id: "empty" }, message: {} } as WAMessage,
      ],
    });
    expect(store.listChats()).toHaveLength(0);
  });

  it("dedupes messages by id", () => {
    const store = new ConversationStore();
    const msg = textMessage("a@s.whatsapp.net", "dupe", { id: "x", ts: 1 });
    store.ingestMessages({ messages: [msg] });
    store.ingestMessages({ messages: [msg] });
    expect(store.readConversation("a@s.whatsapp.net")).toHaveLength(1);
  });

  it("caps messages per chat and honours the read limit", () => {
    const store = new ConversationStore();
    const messages = Array.from({ length: 80 }, (_, i) =>
      textMessage("a@s.whatsapp.net", `msg-${i}`, { id: `id-${i}`, ts: i + 1 }),
    );
    store.ingestMessages({ messages });

    // Buffer capped at 50 → only the newest 50 survive.
    const all = store.readConversation("a@s.whatsapp.net", 999);
    expect(all).toHaveLength(50);
    expect(all[0].text).toBe("msg-30");
    expect(all.at(-1)?.text).toBe("msg-79");

    // Read limit returns the newest N.
    const recent = store.readConversation("a@s.whatsapp.net", 3);
    expect(recent.map((m) => m.text)).toEqual(["msg-77", "msg-78", "msg-79"]);
  });

  it("binds to an emitter and detaches cleanly", () => {
    const store = new ConversationStore();
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const ev = {
      on: (event: string, listener: (...args: unknown[]) => void) => listeners.set(event, listener),
      off: (event: string) => listeners.delete(event),
    };
    const detach = store.bind(ev);
    expect(listeners.has("messaging-history.set")).toBe(true);

    listeners.get("messages.upsert")?.({
      messages: [textMessage("a@s.whatsapp.net", "via-event", { ts: 9 })],
    });
    expect(store.readConversation("a@s.whatsapp.net")[0].text).toBe("via-event");

    detach();
    expect(listeners.size).toBe(0);
  });
});

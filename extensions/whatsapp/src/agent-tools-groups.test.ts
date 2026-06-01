import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getActiveWebListener, resolveWebAccountId } from "./active-listener.js";
import { createWhatsAppGroupTools } from "./agent-tools-groups.js";
import type { ActiveWebListener } from "./inbound/types.js";

const getRuntimeConfigMock = vi.fn<() => OpenClawConfig>();

vi.mock("openclaw/plugin-sdk/runtime-config-snapshot", () => ({
  getRuntimeConfig: () => getRuntimeConfigMock(),
}));

vi.mock("./active-listener.js", () => ({
  getActiveWebListener: vi.fn(),
  resolveWebAccountId: vi.fn(() => "default"),
}));

const getActiveWebListenerMock = vi.mocked(getActiveWebListener);
const resolveWebAccountIdMock = vi.mocked(resolveWebAccountId);

function cfgWithGroups(enabled: boolean): OpenClawConfig {
  return {
    channels: { whatsapp: { actions: { groups: enabled } } },
  } as unknown as OpenClawConfig;
}

function stubListener(): ActiveWebListener {
  return {
    sendMessage: vi.fn(),
    sendPoll: vi.fn(),
    sendReaction: vi.fn(),
    sendComposingTo: vi.fn(),
    createGroup: vi.fn(async (subject: string) => ({
      groupJid: "120363000000000000@g.us",
      subject,
    })),
    addGroupParticipants: vi.fn(async (_jid: string, participants: string[]) =>
      participants.map((jid) => ({ jid, status: "200" })),
    ),
    getGroupInviteCode: vi.fn(async () => ({
      code: "INVITE1234",
      inviteLink: "https://chat.whatsapp.com/INVITE1234",
    })),
  } as unknown as ActiveWebListener;
}

function toolsByName() {
  const tools = createWhatsAppGroupTools({ cfg: cfgWithGroups(true) });
  return new Map(tools.map((t) => [t.name, t]));
}

describe("createWhatsAppGroupTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveWebAccountIdMock.mockReturnValue("default");
  });

  it("returns no tools when the groups action gate is disabled", () => {
    expect(createWhatsAppGroupTools({ cfg: cfgWithGroups(false) })).toEqual([]);
    expect(createWhatsAppGroupTools({ cfg: undefined })).toEqual([]);
  });

  it("registers the three group tools when the gate is enabled", () => {
    const names = createWhatsAppGroupTools({ cfg: cfgWithGroups(true) }).map((t) => t.name);
    expect(names).toEqual([
      "whatsapp_group_create",
      "whatsapp_group_add_participants",
      "whatsapp_group_invite_link",
    ]);
  });

  it("creates a group via the active listener", async () => {
    const listener = stubListener();
    getActiveWebListenerMock.mockReturnValue(listener);
    getRuntimeConfigMock.mockReturnValue(cfgWithGroups(true));

    const tool = toolsByName().get("whatsapp_group_create")!;
    const result = await tool.execute("call-1", {
      subject: "Team",
      participants: ["+15555550000"],
    });

    expect(listener.createGroup).toHaveBeenCalledWith("Team", ["+15555550000"]);
    expect(result.details).toEqual({ groupJid: "120363000000000000@g.us", subject: "Team" });
  });

  it("throws when the gate is disabled at execute time", async () => {
    getRuntimeConfigMock.mockReturnValue(cfgWithGroups(false));
    const tool = toolsByName().get("whatsapp_group_create")!;
    await expect(
      tool.execute("call-1", { subject: "Team", participants: ["+15555550000"] }),
    ).rejects.toThrow(/disabled/);
  });

  it("throws when WhatsApp is not linked", async () => {
    getActiveWebListenerMock.mockReturnValue(null);
    getRuntimeConfigMock.mockReturnValue(cfgWithGroups(true));
    const tool = toolsByName().get("whatsapp_group_create")!;
    await expect(
      tool.execute("call-1", { subject: "Team", participants: ["+15555550000"] }),
    ).rejects.toThrow(/not linked/);
  });

  it("rejects an invalid group JID for add-participants", async () => {
    getActiveWebListenerMock.mockReturnValue(stubListener());
    getRuntimeConfigMock.mockReturnValue(cfgWithGroups(true));
    const tool = toolsByName().get("whatsapp_group_add_participants")!;
    await expect(
      tool.execute("call-1", { group_jid: "not-a-jid", participants: ["+15555550000"] }),
    ).rejects.toThrow(/group_jid/);
  });

  it("returns the invite link", async () => {
    getActiveWebListenerMock.mockReturnValue(stubListener());
    getRuntimeConfigMock.mockReturnValue(cfgWithGroups(true));
    const tool = toolsByName().get("whatsapp_group_invite_link")!;
    const result = await tool.execute("call-1", { group_jid: "120363000000000000@g.us" });
    expect(result.content).toEqual([
      { type: "text", text: "https://chat.whatsapp.com/INVITE1234" },
    ]);
  });
});

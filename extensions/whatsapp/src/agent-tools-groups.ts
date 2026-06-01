import { createActionGate } from "openclaw/plugin-sdk/channel-actions";
import type { ChannelAgentTool } from "openclaw/plugin-sdk/channel-contract";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { getRuntimeConfig } from "openclaw/plugin-sdk/runtime-config-snapshot";
import { Type } from "typebox";
import { getActiveWebListener, resolveWebAccountId } from "./active-listener.js";
import type { ActiveWebListener } from "./inbound/types.js";

const GROUP_JID_PATTERN = "@g.us";

function areWhatsAppGroupActionsEnabled(cfg: OpenClawConfig): boolean {
  if (!cfg.channels?.whatsapp) {
    return false;
  }
  // Default false: group creation/participant changes can add arbitrary people
  // to chats, so they are opt-in via channels.whatsapp.actions.groups.
  return createActionGate(cfg.channels.whatsapp.actions)("groups", false);
}

/**
 * Resolve the active, linked WhatsApp listener for the given account, enforcing
 * the `groups` action gate. Reads live config so a runtime toggle is honored
 * without a gateway restart. Throws a clear, agent-readable error otherwise.
 */
function requireGroupCapableListener(accountIdArg: unknown): ActiveWebListener {
  const cfg = getRuntimeConfig();
  if (!areWhatsAppGroupActionsEnabled(cfg)) {
    throw new Error(
      "WhatsApp group actions are disabled. Set channels.whatsapp.actions.groups = true to enable them.",
    );
  }
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

function readParticipants(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("participants must be a non-empty array of phone numbers (E.164).");
  }
  const participants = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  if (participants.length === 0) {
    throw new Error("participants must contain at least one phone number (E.164).");
  }
  return participants;
}

function readGroupJid(value: unknown): string {
  const jid = typeof value === "string" ? value.trim() : "";
  if (!jid.endsWith(GROUP_JID_PATTERN)) {
    throw new Error("group_jid must be a WhatsApp group JID, e.g. 120363012345678901@g.us.");
  }
  return jid;
}

function createWhatsAppGroupCreateTool(): ChannelAgentTool {
  return {
    label: "WhatsApp Create Group",
    name: "whatsapp_group_create",
    description:
      "Create a new WhatsApp group with the given subject and participants. Returns the new group JID — use it for future group operations.",
    parameters: Type.Object({
      subject: Type.String({ description: "Group name." }),
      participants: Type.Array(Type.String(), {
        description: "Phone numbers in E.164 format, e.g. +15551234567.",
      }),
      accountId: Type.Optional(Type.String()),
    }),
    execute: async (_toolCallId, args) => {
      const { subject, participants, accountId } = args as {
        subject?: string;
        participants?: unknown;
        accountId?: string;
      };
      const trimmedSubject = typeof subject === "string" ? subject.trim() : "";
      if (!trimmedSubject) {
        throw new Error("subject is required.");
      }
      const listener = requireGroupCapableListener(accountId);
      const result = await listener.createGroup(trimmedSubject, readParticipants(participants));
      return {
        content: [
          {
            type: "text",
            text: `Created WhatsApp group "${result.subject}" (${result.groupJid}).`,
          },
        ],
        details: result,
      };
    },
  };
}

function createWhatsAppGroupAddTool(): ChannelAgentTool {
  return {
    label: "WhatsApp Add Group Participants",
    name: "whatsapp_group_add_participants",
    description: "Add participants to an existing WhatsApp group.",
    parameters: Type.Object({
      group_jid: Type.String({
        description: "Group JID, e.g. 120363012345678901@g.us.",
      }),
      participants: Type.Array(Type.String(), {
        description: "Phone numbers in E.164 format to add.",
      }),
      accountId: Type.Optional(Type.String()),
    }),
    execute: async (_toolCallId, args) => {
      const { group_jid, participants, accountId } = args as {
        group_jid?: unknown;
        participants?: unknown;
        accountId?: string;
      };
      const groupJid = readGroupJid(group_jid);
      const listener = requireGroupCapableListener(accountId);
      const results = await listener.addGroupParticipants(groupJid, readParticipants(participants));
      return {
        content: [
          {
            type: "text",
            text: results.map((r) => `${r.jid ?? "(unknown)"}: ${r.status}`).join("\n"),
          },
        ],
        details: { groupJid, results },
      };
    },
  };
}

function createWhatsAppGroupInviteLinkTool(): ChannelAgentTool {
  return {
    label: "WhatsApp Group Invite Link",
    name: "whatsapp_group_invite_link",
    description: "Get the invite link for a WhatsApp group the bot administers.",
    parameters: Type.Object({
      group_jid: Type.String({
        description: "Group JID, e.g. 120363012345678901@g.us.",
      }),
      accountId: Type.Optional(Type.String()),
    }),
    execute: async (_toolCallId, args) => {
      const { group_jid, accountId } = args as {
        group_jid?: unknown;
        accountId?: string;
      };
      const groupJid = readGroupJid(group_jid);
      const listener = requireGroupCapableListener(accountId);
      const result = await listener.getGroupInviteCode(groupJid);
      return {
        content: [{ type: "text", text: result.inviteLink }],
        details: { groupJid, ...result },
      };
    },
  };
}

/**
 * WhatsApp group-management agent tools. Returned only when
 * `channels.whatsapp.actions.groups` is enabled, so disabled installs don't
 * advertise tools the agent can't use. Each tool also re-checks the gate at
 * execute time and requires an active linked listener.
 */
export function createWhatsAppGroupTools(params: { cfg?: OpenClawConfig }): ChannelAgentTool[] {
  if (!params.cfg || !areWhatsAppGroupActionsEnabled(params.cfg)) {
    return [];
  }
  return [
    createWhatsAppGroupCreateTool(),
    createWhatsAppGroupAddTool(),
    createWhatsAppGroupInviteLinkTool(),
  ];
}

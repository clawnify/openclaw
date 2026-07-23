import { resolveAllowlistProviderRuntimeGroupPolicy } from "openclaw/plugin-sdk/runtime-group-policy";

export function resolveWhatsAppRuntimeGroupPolicy(params: {
  providerConfigPresent: boolean;
  groupPolicy?: "open" | "allowlist" | "disabled";
  defaultGroupPolicy?: "open" | "allowlist" | "disabled";
}): {
  groupPolicy: "open" | "allowlist" | "disabled";
  providerMissingFallbackApplied: boolean;
} {
  // Fail closed: a configured channels.whatsapp without an explicit groupPolicy
  // should not admit every group the linked number is a member of. Fall back to
  // "allowlist" instead of "open" — group inbound stays blocked until groups are
  // explicitly configured (groupAllowFrom senders still pass, and explicit
  // groupPolicy values are honored unchanged).
  return resolveAllowlistProviderRuntimeGroupPolicy({
    providerConfigPresent: params.providerConfigPresent,
    groupPolicy: params.groupPolicy,
    defaultGroupPolicy: params.defaultGroupPolicy,
  });
}

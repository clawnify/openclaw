import { describe, expect, it } from "vitest";
import { resolveWhatsAppRuntimeGroupPolicy } from "./runtime-group-policy.js";

describe("resolveWhatsAppRuntimeGroupPolicy (Clawnify fail-closed)", () => {
  it("falls back to allowlist when channels.whatsapp exists without groupPolicy", () => {
    // Regression: the open fallback admitted every group when groupPolicy was absent.
    const result = resolveWhatsAppRuntimeGroupPolicy({ providerConfigPresent: true });
    expect(result.groupPolicy).toBe("allowlist");
  });

  it("falls back to allowlist when channels.whatsapp is missing entirely", () => {
    const result = resolveWhatsAppRuntimeGroupPolicy({ providerConfigPresent: false });
    expect(result.groupPolicy).toBe("allowlist");
    expect(result.providerMissingFallbackApplied).toBe(true);
  });

  it("honors an explicit groupPolicy", () => {
    for (const groupPolicy of ["open", "allowlist", "disabled"] as const) {
      const result = resolveWhatsAppRuntimeGroupPolicy({
        providerConfigPresent: true,
        groupPolicy,
      });
      expect(result.groupPolicy).toBe(groupPolicy);
    }
  });

  it("honors channels.defaults.groupPolicy over the fallback", () => {
    const result = resolveWhatsAppRuntimeGroupPolicy({
      providerConfigPresent: true,
      defaultGroupPolicy: "open",
    });
    expect(result.groupPolicy).toBe("open");
  });
});

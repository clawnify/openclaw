import { describe, expect, it } from "vitest";
import { resolveWhatsAppDeviceLabel } from "./session.js";

describe("resolveWhatsAppDeviceLabel", () => {
  it("defaults to the project name when unset", () => {
    expect(resolveWhatsAppDeviceLabel({})).toBe("OpenClaw");
  });

  it("uses the deployment override when set", () => {
    expect(resolveWhatsAppDeviceLabel({ OPENCLAW_WHATSAPP_DEVICE_LABEL: "Acme Agency" })).toBe(
      "Acme Agency",
    );
  });

  it("ignores a blank override", () => {
    expect(resolveWhatsAppDeviceLabel({ OPENCLAW_WHATSAPP_DEVICE_LABEL: "   " })).toBe("OpenClaw");
  });

  it("trims the override", () => {
    expect(resolveWhatsAppDeviceLabel({ OPENCLAW_WHATSAPP_DEVICE_LABEL: "  Acme  " })).toBe("Acme");
  });
});

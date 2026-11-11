import { describe, expect, it } from "vitest";
import { assertPublicUrl, isPrivateIp } from "../../src/lib/crawling/ssrf";

describe("ssrf guard", () => {
  it("flags private ranges", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.1", "169.254.169.254", "0.0.0.0", "::1", "fd00::1", "::ffff:127.0.0.1"]) expect(isPrivateIp(ip)).toBe(true);
    for (const ip of ["8.8.8.8", "2606:4700:4700::1111"]) expect(isPrivateIp(ip)).toBe(false);
  });
  it("rejects loopback, metadata and non-http URLs", async () => {
    await expect(assertPublicUrl("http://127.0.0.1/")).rejects.toThrow();
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow();
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow();
    await expect(assertPublicUrl("http://8.8.8.8/")).resolves.toBeUndefined();
  });
});

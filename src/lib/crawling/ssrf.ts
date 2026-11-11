import { lookup as dnsLookup } from "node:dns/promises";
import net from "node:net";
import { Agent } from "undici";

const blocked = new net.BlockList();
for (const [a, p] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) blocked.addSubnet(a, p, "ipv4");
for (const [a, p] of [["::", 128], ["::1", 128], ["::", 96], ["64:ff9b::", 96], ["100::", 64], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) blocked.addSubnet(a, p, "ipv6");

/** True for loopback, private, link-local, CGNAT, ULA, multicast, unspecified and any IPv4-mapped/compatible IPv6 address. */
export function isPrivateIp(ip: string): boolean {
  const family = net.isIP(ip);
  return family === 0 || blocked.check(ip, family === 4 ? "ipv4" : "ipv6");
}

/** Throws unless url is http(s) and every address its host resolves to is public. */
export async function assertPublicUrl(url: string): Promise<void> {
  const u = new URL(url);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`blocked scheme ${u.protocol}`);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [{ address: host }] : await dnsLookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error(`blocked non-public address for ${host}`);
}

/** undici dispatcher that re-checks the address actually connected to, closing the DNS-rebinding window. */
export const safeDispatcher = new Agent({
  connect: {
    lookup: (hostname, options, cb) => {
      dnsLookup(hostname, { all: true }).then(
        (addrs) => {
          const bad = addrs.find((a) => isPrivateIp(a.address));
          if (bad || !addrs.length) return cb(new Error(`blocked non-public address for ${hostname}`) as NodeJS.ErrnoException, "", 4);
          if ((options as { all?: boolean }).all) return (cb as unknown as (e: null, a: typeof addrs) => void)(null, addrs);
          cb(null, addrs[0].address, addrs[0].family);
        },
        (e) => cb(e, "", 4),
      );
    },
  },
});

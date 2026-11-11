import { getCrawlPolicy, userAgent } from "../config";

interface RobotsRules {
  allow: string[];
  disallow: string[];
  sitemaps: string[];
  fetchedAt: number;
  crawlDelay?: number;
}

const cache = new Map<string, RobotsRules>();
const TTL = 60 * 60 * 1000;

export function parseRobots(body: string, agent = "scholarshipintelligencebot"): RobotsRules {
  const rules: RobotsRules = { allow: [], disallow: [], sitemaps: [], fetchedAt: Date.now() };
  let groups: { agents: string[]; allow: string[]; disallow: string[]; delay?: number }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const k = line.slice(0, idx).trim().toLowerCase();
    const v = line.slice(idx + 1).trim();
    if (k === "sitemap") {
      rules.sitemaps.push(v);
      continue;
    }
    if (k === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], allow: [], disallow: [] };
        groups.push(cur);
      }
      cur.agents.push(v.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (k === "allow" && v) cur.allow.push(v);
    else if (k === "disallow" && v) cur.disallow.push(v);
    else if (k === "crawl-delay") cur.delay = parseFloat(v);
  }
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  for (const g of chosen) {
    rules.allow.push(...g.allow);
    rules.disallow.push(...g.disallow);
    if (g.delay) rules.crawlDelay = g.delay;
  }
  return rules;
}

export function pathAllowed(rules: Pick<RobotsRules, "allow" | "disallow">, pathAndQuery: string): boolean {
  const match = (p: string) => {
    const re = new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    return re.test(pathAndQuery);
  };
  let best = { len: -1, allow: true };
  for (const p of rules.disallow) if (match(p) && p.length > best.len) best = { len: p.length, allow: false };
  for (const p of rules.allow) if (match(p) && p.length >= best.len) best = { len: p.length, allow: true };
  return best.allow;
}

async function getRules(origin: string): Promise<RobotsRules> {
  const hit = cache.get(origin);
  if (hit && Date.now() - hit.fetchedAt < TTL) return hit;
  let rules: RobotsRules = { allow: [], disallow: [], sitemaps: [], fetchedAt: Date.now() };
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), getCrawlPolicy().http.connect_timeout_ms);
    const res = await fetch(origin + "/robots.txt", { signal: ctl.signal, headers: { "user-agent": userAgent() } });
    clearTimeout(t);
    // 4xx => no restrictions published; 5xx/unreachable => be conservative only for 5xx
    if (res.ok) rules = parseRobots(await res.text());
    else if (res.status >= 500) rules.disallow = ["/"];
  } catch {
    /* unreachable robots.txt: allow, the page fetch itself will surface the failure */
  }
  cache.set(origin, rules);
  return rules;
}

export async function robotsAllowed(url: string): Promise<{ allowed: boolean; sitemaps: string[]; crawlDelay?: number }> {
  const u = new URL(url);
  if (u.protocol === "fixture:") return { allowed: true, sitemaps: [] };
  const rules = await getRules(u.origin);
  return { allowed: pathAllowed(rules, u.pathname + u.search), sitemaps: rules.sitemaps, crawlDelay: rules.crawlDelay };
}

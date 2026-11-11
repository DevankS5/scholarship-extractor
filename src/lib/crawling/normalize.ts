import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { collapseWs } from "../util";

export interface PageLink {
  href: string;
  text: string;
}

export interface NormalizedDocument {
  kind: "HTML" | "PDF";
  title: string | null;
  text: string;
  links: PageLink[];
}

const SKIP = new Set(["script", "style", "noscript", "nav", "footer", "aside", "form", "svg", "iframe", "template", "head"]);
const BLOCK = new Set(["p", "div", "section", "article", "ul", "ol", "br", "header", "main", "blockquote", "dl", "dt", "dd", "figure", "details", "summary", "address", "pre"]);
const MAX_TEXT = 200_000;

/**
 * HTML → normalised text. Headings are rendered as "# " / "## " lines, list items as "- ",
 * tables as "Label: value" rows so a value never loses its row label.
 * Navigation/footer/scripts are removed; the original response hash is stored separately.
 */
export function normalizeHtml(html: string, baseUrl: string): NormalizedDocument {
  const $ = cheerio.load(html);
  const title = collapseWs($("title").first().text()) || null;

  const resolve = (href: string): string | null => {
    try {
      const u = new URL(href, baseUrl);
      if (!["http:", "https:", "fixture:"].includes(u.protocol)) return null;
      return u.toString();
    } catch {
      return null;
    }
  };

  const links: PageLink[] = [];
  $("a[href]").each((_, el) => {
    const href = resolve($(el).attr("href") || "");
    if (href) links.push({ href, text: collapseWs($(el).text()) });
  });

  $("script,style,noscript,svg,template,iframe").remove();
  let root = $("main").first();
  if (!root.length) root = $("article").first();
  if (!root.length) root = $("[role=main]").first();
  if (!root.length) root = $("#content, .content, #main").first();
  if (!root.length) root = $("body").first();

  const lines: string[] = [];
  let buf = "";
  const flush = () => {
    const t = collapseWs(buf);
    if (t) lines.push(t);
    buf = "";
  };

  const renderTable = (tbl: Element) => {
    const rows: string[][] = [];
    $(tbl)
      .find("tr")
      .each((_, tr) => {
        const cells: string[] = [];
        $(tr)
          .children("th,td")
          .each((__, c) => {
            cells.push(collapseWs($(c).text()));
          });
        if (cells.some(Boolean)) rows.push(cells);
      });
    if (!rows.length) return;
    const caption = collapseWs($(tbl).find("caption").first().text());
    if (caption) lines.push(`## ${caption}`);
    const hasHeader = $(tbl).find("th").length > 0 && rows[0].length > 2;
    if (rows.every((r) => r.length === 2) || !hasHeader) {
      for (const r of rows) lines.push(r.length === 2 ? `${r[0]}: ${r[1]}` : r.join(" | "));
    } else {
      const header = rows[0];
      for (const r of rows.slice(1)) lines.push(r.map((c, i) => `${header[i] ?? "col" + i}: ${c}`).join(" | "));
    }
  };

  const walk = (node: AnyNode) => {
    if (node.type === "text") {
      buf += " " + (node as unknown as { data: string }).data;
      return;
    }
    if (node.type !== "tag") return;
    const el = node as Element;
    const tag = el.name.toLowerCase();
    if (SKIP.has(tag)) return;
    if (/^h[1-6]$/.test(tag)) {
      flush();
      const t = collapseWs($(el).text());
      if (t) lines.push(`${tag === "h1" ? "#" : "##"} ${t}`);
      return;
    }
    if (tag === "table") {
      flush();
      renderTable(el);
      return;
    }
    if (tag === "li") {
      flush();
      const t = collapseWs($(el).text());
      if (t) lines.push(`- ${t}`);
      return;
    }
    if (BLOCK.has(tag) || tag === "tr") {
      flush();
      el.children.forEach(walk);
      flush();
      return;
    }
    el.children.forEach(walk);
  };
  root.each((_, el) => walk(el));
  flush();

  // Link targets inside the main content are retained as a separate section so evidence can cite them.
  const contentLinks: string[] = [];
  const seen = new Set<string>();
  root.find("a[href]").each((_, el) => {
    const href = resolve($(el).attr("href") || "");
    const text = collapseWs($(el).text());
    if (!href || !text || seen.has(href + text)) return;
    seen.add(href + text);
    contentLinks.push(`- ${text} -> ${href}`);
  });
  if (contentLinks.length) lines.push("## Links", ...contentLinks.slice(0, 80));

  return { kind: "HTML", title, text: lines.join("\n").slice(0, MAX_TEXT), links };
}

export async function normalizePdf(buf: Buffer): Promise<NormalizedDocument> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = (Array.isArray(text) ? text : [text]) as string[];
  const parts = pages.map((p, i) => `[Page ${i + 1}]\n${p.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim()}`);
  const joined = parts.join("\n\n").slice(0, MAX_TEXT);
  const firstLine = joined.split("\n").find((l) => l.trim() && !l.startsWith("[Page")) ?? null;
  return { kind: "PDF", title: firstLine ? collapseWs(firstLine).slice(0, 200) : null, text: joined, links: [] };
}

export function pageForOffset(text: string, offset: number): number | null {
  const re = /\[Page (\d+)\]/g;
  let m: RegExpExecArray | null;
  let page: number | null = null;
  while ((m = re.exec(text)) && m.index <= offset) page = +m[1];
  return page;
}

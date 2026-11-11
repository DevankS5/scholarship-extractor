/**
 * Stage B (OPTIONAL): local-LLM assistance via Ollama. Disabled unless OLLAMA_ENABLED=true.
 * The model only proposes values + exact quotes for fields the deterministic stage left empty.
 * Every proposal is validated against the real source text; unsupported output is discarded.
 * LLM-derived fields are marked PARTIALLY_SUPPORTED, so they can never by themselves lead to VERIFIED.
 * The LLM never sets confidence or verification status.
 */
import type { NormalizedDocument } from "../crawling/normalize";
import { quoteInText } from "../util";
import type { ExtractionResult, FieldValue } from "./extractor";

const FIELDS = ["eligibility_summary", "selection_process", "renewal_requirements"] as const;

export const llmEnabled = () => process.env.OLLAMA_ENABLED === "true" && !!process.env.OLLAMA_URL;

export async function augmentWithLlm(doc: NormalizedDocument, result: ExtractionResult): Promise<ExtractionResult> {
  if (!llmEnabled()) return result;
  const missing = FIELDS.filter((f) => !result.fields[f]);
  if (!missing.length || !result.isScholarshipPage) return result;
  const prompt = `You extract facts from scholarship web pages. Use ONLY the text between <source> tags. Do not use outside knowledge.
Return strict JSON: {${missing.map((m) => `"${m}": {"value": string, "quote": string} | null`).join(", ")}}.
"quote" must be copied EXACTLY (character for character) from the source. Use null when the source does not state the field.
Never infer income limits, dates, amounts or categories.
<source>
${doc.text.slice(0, 12000)}
</source>`;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 60_000);
    const res = await fetch(`${process.env.OLLAMA_URL}/api/generate`, {
      method: "POST",
      signal: ctl.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.OLLAMA_MODEL || "llama3.1:8b", prompt, stream: false, format: "json", options: { temperature: 0 } }),
    });
    clearTimeout(t);
    if (!res.ok) return result;
    const body = (await res.json()) as { response?: string };
    const parsed = JSON.parse(body.response ?? "{}") as Record<string, { value?: string; quote?: string } | null>;
    const fields = { ...result.fields };
    for (const f of missing) {
      const p = parsed[f];
      if (!p?.value || !p.quote) continue;
      if (!quoteInText(doc.text, p.quote)) {
        result.droppedFields.push(`${f}(llm)`);
        continue;
      }
      const start = Math.max(0, doc.text.indexOf(p.quote));
      const fv: FieldValue = { field: f, value: p.value.slice(0, 1200), raw: null, quote: p.quote, start, end: start + p.quote.length, method: "LLM_VALIDATED", support: "PARTIALLY_SUPPORTED", section: null };
      fields[f] = fv;
    }
    return { ...result, fields };
  } catch {
    return result; // model unavailable => deterministic result stands
  }
}

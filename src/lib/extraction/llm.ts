/**
 * Stage B (OPTIONAL): LLM assistance. Gemini when GEMINI_API_KEY is set, else local Ollama when OLLAMA_ENABLED=true.
 * The model only proposes values + exact quotes for fields the deterministic stage left empty.
 * Every proposal is validated against the real source text; unsupported output is discarded.
 * LLM-derived fields are marked PARTIALLY_SUPPORTED, so they can never by themselves lead to VERIFIED.
 * The LLM never sets confidence or verification status.
 */
import type { NormalizedDocument } from "../crawling/normalize";
import { quoteInText } from "../util";
import { classifyPage, type ExtractionResult, type FieldValue } from "./extractor";

const TEXT_FIELDS = ["description", "eligibility_summary", "selection_process", "renewal_requirements", "application_instructions"] as const;
const FIELDS = [...TEXT_FIELDS, "closing_date"] as const;

const gemini = () => !!process.env.GEMINI_API_KEY;
const ollama = () => process.env.OLLAMA_ENABLED === "true" && !!process.env.OLLAMA_URL;
export const llmEnabled = () => gemini() || ollama();
const geminiModels = () => (process.env.GEMINI_MODEL || "gemini-3.5-flash,gemini-3.5-flash-lite,gemini-flash-latest").split(",").map((m) => m.trim()).filter(Boolean);
export const llmLabel = () => (gemini() ? `gemini:${geminiModels()[0]}` : ollama() ? `ollama:${process.env.OLLAMA_MODEL || "llama3.1:8b"}` : "none");

async function complete(prompt: string, signal: AbortSignal): Promise<string | null> {
  if (gemini()) {
    // GEMINI_MODEL may list several models: free-tier quotas are per model, so fall through on 429.
    for (const model of geminiModels()) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, responseMimeType: "application/json" },
        }),
      });
      if (res.status === 429) continue;
      if (!res.ok) return null;
      const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      return body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? null;
    }
    return null;
  }
  const res = await fetch(`${process.env.OLLAMA_URL}/api/generate`, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: process.env.OLLAMA_MODEL || "llama3.1:8b", prompt, stream: false, format: "json", options: { temperature: 0 } }),
  });
  if (!res.ok) return null;
  return ((await res.json()) as { response?: string }).response ?? null;
}

export async function augmentWithLlm(doc: NormalizedDocument, result: ExtractionResult): Promise<ExtractionResult> {
  if (!llmEnabled()) return result;
  const missing = FIELDS.filter((f) => !result.fields[f]);
  // Only pages that already look like a single programme (named like one, with at least one rule signal).
  const name = result.fields.name?.value as string | undefined;
  if (!missing.length || !name || !/(scholarship|fellowship|grant|award|scheme|bursary|programme|program|stipend)/i.test(name)) return result;
  if (!result.isScholarshipPage && result.pageSignals.length < 1) return result;
  const shape = missing
    .map((m) => (m === "closing_date" ? `"closing_date": {"value": "YYYY-MM-DD", "quote": string} | null` : `"${m}": {"value": string, "quote": string} | null`))
    .join(", ");
  const prompt = `You extract facts from ONE scholarship web page. Use ONLY the text between <source> tags. Do not use outside knowledge.
Return strict JSON: {${shape}}.
"quote" must be copied EXACTLY (character for character, max 300 chars) from the source and must state the value.
"value" is a short factual summary of the quote (max 400 chars). Use null when the source does not state the field.
Never infer income limits, dates, amounts or categories. closing_date only when the quote contains the full date including the year.
<source>
${doc.text.slice(0, 14000)}
</source>`;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 45_000);
    const raw = await complete(prompt, ctl.signal);
    clearTimeout(t);
    if (!raw) return result;
    const parsed = JSON.parse(raw) as Record<string, { value?: string; quote?: string } | null>;
    const fields = { ...result.fields };
    const droppedFields = [...result.droppedFields];
    for (const f of missing) {
      const p = parsed[f];
      if (!p?.value || !p.quote) continue;
      const year = f === "closing_date" ? p.value.slice(0, 4) : null;
      const validDate = f !== "closing_date" || (/^\d{4}-\d{2}-\d{2}$/.test(p.value) && !Number.isNaN(Date.parse(p.value)) && p.quote.includes(year!));
      if (!validDate || !quoteInText(doc.text, p.quote)) {
        droppedFields.push(`${f}(llm)`);
        continue;
      }
      const start = Math.max(0, doc.text.indexOf(p.quote));
      const fv: FieldValue = { field: f, value: p.value.slice(0, 1200), raw: f === "closing_date" ? p.quote : null, quote: p.quote, start, end: start + p.quote.length, method: "LLM_VALIDATED", support: "PARTIALLY_SUPPORTED", section: null };
      fields[f] = fv;
    }
    const { isScholarshipPage, pageSignals } = classifyPage(fields, result.signals);
    return { ...result, fields, droppedFields, isScholarshipPage: result.isScholarshipPage || isScholarshipPage, pageSignals };
  } catch {
    return result; // model unavailable => deterministic result stands
  }
}

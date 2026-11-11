import { Card } from "@/components/ui";
import { COMPONENT_MAX, FIELD_WEIGHTS } from "@/lib/verification/verifier";

export default function About() {
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">How records are trusted</h1>
      <Card title="Pipeline">
        <p className="text-sm text-slate-700">discover → classify → fetch → extract → resolve official source → verify → score → persist → display → recrawl → detect change</p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>Discovery: seed listings, bounded link traversal, sitemaps, official cross-links, aggregator leads, manual submissions, optional SearXNG search leads.</li>
          <li>Extraction is deterministic and evidence-first: every non-null field carries an exact quote that must exist in the stored text; otherwise it is dropped. An optional local LLM (Ollama) may only propose values with quotes, which are validated and always rated “partially supported”.</li>
          <li>Source authority is decided from the registry (reviewed official domains) plus provider identity on the page — never from a domain suffix alone.</li>
          <li>Failures never imply removal. Only repeated failures beyond a grace period yield NO_LONGER_VERIFIABLE; only explicit provider wording yields REMOVED.</li>
          <li>Changes are compared field-by-field on normalised values; eligibility changes and field removals need reviewer approval. History is immutable.</li>
        </ul>
      </Card>
      <Card title="Confidence policy v1.0 (deterministic, not a probability)">
        <table className="text-sm">
          <tbody>
            {Object.entries(COMPONENT_MAX).map(([k, v]) => <tr key={k}><td className="pr-6 capitalize">{k.replace(/_/g, " ")}</td><td className="font-mono">{v}</td></tr>)}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500">Critical-field weights: {Object.entries(FIELD_WEIGHTS).map(([k, v]) => `${k} ${v}`).join(", ")}. VERIFIED requires score ≥ 95 <b>and</b> all gates: primary source confirmed, official presence, critical fields supported, provenance complete, no unresolved conflict (plus India-eligibility evidence for international providers).</p>
      </Card>
    </div>
  );
}

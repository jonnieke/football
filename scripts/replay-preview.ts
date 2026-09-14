export interface ReplayReport {
  match: string;
  kickoff: string;
  capturedAt: string;
  fixtureId: string;
  captureSha256: string;
  sourceEvents: number;
  canonicalEvents: number;
  reviews: number;
  pending: number;
  duplicateCheckPassed: boolean;
  content: Array<{
    eventType: string;
    minute: number | null;
    extraTime: number | null;
    shortText: string;
    standardText: string;
  }>;
}

export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );

export function replayPreview(report: ReplayReport) {
  const e = escapeHtml;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>TEST ONLY — Football replay</title><style>
body{margin:0;background:#eef3f1;color:#153b37;font:17px/1.55 system-ui,sans-serif}main{max-width:960px;margin:auto;padding:32px 22px}header,article,.notice{background:white;border:1px solid #ccdbd4;border-radius:14px;padding:24px;margin:18px 0}h1{font-size:32px;line-height:1.2}h2{font-size:21px}.badge{font-weight:750;color:#7a4100;letter-spacing:.1em}small{color:#49645d}.stats{display:flex;flex-wrap:wrap;gap:12px}.stats p{background:#dae9e1;padding:14px;border-radius:10px;flex:1;min-width:145px}code{overflow-wrap:anywhere}article p{white-space:pre-wrap}dt{font-weight:700}dd{margin:0 0 12px}.notice{border-left:6px solid #bc790d}</style></head><body><main>
<header><div class="badge">TEST ONLY · HISTORICAL MATCH</div><h1>${e(report.match)}</h1>
<p>Local replay preview — nothing here has been sent to your live website or emailed.</p>
<small>Kickoff: ${e(report.kickoff)} · Data captured: ${e(report.capturedAt)}</small></header>
<section class="stats" aria-label="Replay results"><p><b>${report.sourceEvents}</b><br>Supported source events</p><p><b>${report.canonicalEvents}</b><br>Canonical events</p><p><b>${report.content.length}</b><br>Content items</p><p><b>${report.reviews}</b><br>Held for review</p></section>
<section class="notice"><h2>What this test proves</h2><p>One completed-match snapshot passed through the platform's database, event detection and template-based content generator. Reprocessing duplicate input: <b>${report.duplicateCheckPassed ? "PASS — no extra content" : "FAIL"}</b>. Pending work: ${report.pending}.</p>
<p>This is not a recording of live polling. Intermediate scores, kickoff and half-time observations were not invented. Goal alerts may show team names without a score because the historical event does not establish the score at that moment. Yellow cards and substitutions are not currently supported alert types.</p>
<p>No queue worker hosting, live API delivery, email delivery, or AI-written article generation is verified here. Newly generated content stays in draft. Exporting this preview is not approval or publication. The temporary local test schema is cleaned up after export.</p></section>
<h2>Generated content</h2>${report.content.length ? report.content.map((item) => `<article><small>${e(item.eventType.replaceAll("_", " "))}${item.minute === null ? "" : ` · ${item.minute}${item.extraTime === null ? "" : `+${item.extraTime}`}′`}</small><p>${e(item.standardText)}</p><details><summary>Short alert (${item.shortText.length} characters)</summary><p>${e(item.shortText)}</p></details></article>`).join("") : "<p>No content generated. Review the held-event count.</p>"}
<footer><h2>Traceability</h2><dl><dt>API-Football fixture</dt><dd>${e(report.fixtureId)}</dd><dt>Capture SHA-256</dt><dd><code>${e(report.captureSha256)}</code></dd></dl><p>This file is a local test artifact, not the live dashboard.</p></footer>
</main></body></html>`;
}

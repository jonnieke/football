export const contentHtml = `<section><div class="toolbar"><h2>Historical / withheld content</h2><button id="draft-reload" class="secondary">Reload withheld items</button></div><p>Fresh eligible events from enabled leagues publish automatically; routine reporting needs no approval. Historical imports, delayed or unverified events, and existing drafts stay out of the live feed. The optional manual action below publishes the exact text and cannot be undone here; it is not required for live reporting.</p><p id="draft-status" role="status"></p><div id="draft-list"></div><button id="draft-more" hidden class="secondary">Load more items</button><h2>Manual publication history</h2><div id="approval-history"></div></section>`;
// Kept as browser JavaScript so the exact shipped classification is tested in a VM.
export const timingScript = `
function draftTimingWarning(item, now = Date.now()) {
  const kickoff = new Date(item.kickoffAt).getTime();
  if (item.fixtureStatus === 'finished') return 'HISTORICAL / CATCH-UP — This match has finished. This is not a live alert.';
  if (!Number.isFinite(kickoff)) return 'TIMING UNVERIFIED — The match date is unavailable. Verify it before publishing.';
  if (now - kickoff >= 24 * 60 * 60 * 1000) return 'HISTORICAL / CATCH-UP — Kickoff was at least 24 hours ago. This may be an outdated alert.';
  return '';
}
function confirmDraftPublication(item) {
  const warning = draftTimingWarning(item);
  if (warning && !confirm(warning + '\\n\\nPublishing does not add this label to the feed text or turn this alert into a recap. Verify the match date and wording. Continue to review the exact text?')) return false;
  return confirm('Publish this exact content to the public feed?\\n\\n' + item.standardText + '\\n\\nShort alert: ' + item.shortText);
}
`;
export const contentScript =
  timingScript +
  `
let draftCursor;
async function loadDrafts(reset = true) {
  const result = await api('/api/content/drafts' + (!reset && draftCursor ? '?after=' + encodeURIComponent(draftCursor) : ''));
  if (reset) byId('draft-list').replaceChildren();
  for (const item of result.items) {
    const card = document.createElement('article'); card.className = 'recipient';
    const heading = document.createElement('h3'); heading.textContent = item.match;
    const meta = document.createElement('p'); meta.textContent = 'DRAFT · ' + item.eventType + ' · Kickoff: ' + new Date(item.kickoffAt).toLocaleString();
    const timing = document.createElement('p'); timing.textContent = draftTimingWarning(item); timing.hidden = !timing.textContent;
    timing.style.fontWeight = 'bold';
    const generated = document.createElement('p'); generated.textContent = 'Draft created: ' + new Date(item.createdAt).toLocaleString() + ' (not the event time)';
    const text = document.createElement('p'); text.textContent = item.standardText;
    const short = document.createElement('p'); short.textContent = 'Short alert: ' + item.shortText;
    const button = document.createElement('button'); button.textContent = 'Approve and publish';
    button.addEventListener('click', () => { if (!confirmDraftPublication(item)) return;
      busy(button, async () => { await api('/api/content/approve', {id:item.id, fingerprint:item.fingerprint}); card.remove(); notice('Content approved and published.'); await loadDrafts(true); await loadApprovalHistory(); }); });
    card.append(heading, meta, timing, generated, text, short, button); byId('draft-list').append(card);
  }
  draftCursor = result.items.at(-1)?.id; byId('draft-more').hidden = result.items.length < 50;
  byId('draft-status').textContent = byId('draft-list').children.length ? 'These items were not automatically published. Manual publication is optional.' : 'No withheld items.';
}
async function loadApprovalHistory() {
  const result = await api('/api/content/history'); byId('approval-history').replaceChildren();
  for (const item of result.items) { const p = document.createElement('p'); p.textContent = new Date(item.createdAt).toLocaleString() + ' · ' + item.actor + ' · ' + item.snapshot.standardText; byId('approval-history').append(p); }
}
byId('draft-reload').addEventListener('click', event => busy(event.target, () => Promise.all([loadDrafts(),loadApprovalHistory()])));
byId('draft-more').addEventListener('click', event => busy(event.target, () => loadDrafts(false)));
`;

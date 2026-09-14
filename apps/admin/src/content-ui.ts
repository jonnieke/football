export const contentHtml = `<section><div class="toolbar"><h2>Drafts awaiting approval</h2><button id="draft-reload" class="secondary">Reload drafts</button></div><p>Newly generated content is private until you approve it. Publishing makes it available to public-feed clients and cannot be undone here. Review the match date: old alerts may no longer be useful.</p><p id="draft-status" role="status"></p><div id="draft-list"></div><button id="draft-more" hidden class="secondary">Load more drafts</button><h2>Recent approvals</h2><div id="approval-history"></div></section>`;
export const contentScript = `
let draftCursor;
async function loadDrafts(reset = true) {
  const result = await api('/api/content/drafts' + (!reset && draftCursor ? '?after=' + encodeURIComponent(draftCursor) : ''));
  if (reset) byId('draft-list').replaceChildren();
  for (const item of result.items) {
    const card = document.createElement('article'); card.className = 'recipient';
    const heading = document.createElement('h3'); heading.textContent = item.match;
    const meta = document.createElement('p'); meta.textContent = 'DRAFT · ' + item.eventType + ' · Kickoff: ' + new Date(item.kickoffAt).toLocaleString();
    const text = document.createElement('p'); text.textContent = item.standardText;
    const short = document.createElement('p'); short.textContent = 'Short alert: ' + item.shortText;
    const button = document.createElement('button'); button.textContent = 'Approve and publish';
    button.addEventListener('click', () => { if (!confirm('Publish this exact content to the public feed?\\n\\n' + item.standardText + '\\n\\nShort alert: ' + item.shortText)) return;
      busy(button, async () => { await api('/api/content/approve', {id:item.id, fingerprint:item.fingerprint}); card.remove(); notice('Content approved and published.'); await loadDrafts(true); await loadApprovalHistory(); }); });
    card.append(heading, meta, text, short, button); byId('draft-list').append(card);
  }
  draftCursor = result.items.at(-1)?.id; byId('draft-more').hidden = result.items.length < 50;
  byId('draft-status').textContent = byId('draft-list').children.length ? 'Review each item before publishing.' : 'No drafts awaiting approval.';
}
async function loadApprovalHistory() {
  const result = await api('/api/content/history'); byId('approval-history').replaceChildren();
  for (const item of result.items) { const p = document.createElement('p'); p.textContent = new Date(item.createdAt).toLocaleString() + ' · ' + item.actor + ' · ' + item.snapshot.standardText; byId('approval-history').append(p); }
}
byId('draft-reload').addEventListener('click', event => busy(event.target, () => Promise.all([loadDrafts(),loadApprovalHistory()])));
byId('draft-more').addEventListener('click', event => busy(event.target, () => loadDrafts(false)));
`;

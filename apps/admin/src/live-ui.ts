export const liveHtml = `<section aria-labelledby="live-heading"><div class="toolbar"><h2 id="live-heading">Administrator live alerts</h2><button id="live-toggle" class="secondary">Pause display updates</button></div>
<p id="live-status" role="status" aria-live="polite">Waiting for sign-in…</p>
<details><summary>About alert timing</summary><p class="hint">This private display checks for published alerts every 5 seconds while visible. It does not start the football workers. Provider and processing delays still apply. Publication time is not event time; earlier reports may be historical. Pausing this display does not pause reporting.</p></details>
<p id="live-alert" role="status" aria-live="polite"></p><div id="live-items"></div></section>`;

export const liveScript = `
let liveCursor, liveTimer, liveController;
let liveStarted = false, liveViewActive = false, livePaused = false, liveRunning = false, liveFailures = 0;
const liveSeen = new Set();
function renderLiveItems(result, initial) {
  const target = byId('live-items');
  if (initial || result.reset) { target.replaceChildren(); liveSeen.clear(); }
  let added = 0;
  for (const item of result.items) {
    if (liveSeen.has(item.id)) continue;
    byId('live-empty')?.remove();
    const card = document.createElement('article'); card.className = 'content-preview'; card.dataset.contentId = item.id;
    const title = document.createElement('h3'); title.textContent = item.match;
    const meta = document.createElement('p'); meta.className = 'hint'; meta.textContent = item.league + ' · ' + item.season + ' · ' + item.eventType.replaceAll('_',' ') + (item.minute === null ? '' : ' · ' + item.minute + "′");
    const text = document.createElement('p'); text.textContent = item.shortText;
    const timing = document.createElement('p'); timing.className = 'hint'; timing.textContent = 'Published: ' + new Date(item.publishedAt).toLocaleString();
    card.append(title,meta,text,timing); target.prepend(card); liveSeen.add(item.id); added++;
  }
  while (target.children.length > 20) { const last = target.lastElementChild; liveSeen.delete(last.dataset.contentId); last.remove(); }
  if (!target.children.length) { const empty = document.createElement('p'); empty.id = 'live-empty'; empty.textContent = 'No published reports yet. New reports will appear here automatically.'; target.append(empty); }
  byId('live-alert').textContent = result.reset ? 'Feed history changed. Showing the latest reports again.' : initial ? 'Recent reports loaded; these are not new-event alerts.' : added ? added + ' newly published report(s) received.' : '';
}
async function pollLiveFeed() {
  clearTimeout(liveTimer);
  if (!liveStarted || !liveViewActive || livePaused || document.hidden || liveRunning) return;
  liveRunning = true; liveController = new AbortController();
  const timeout = setTimeout(() => liveController.abort(), 8000);
  let delay = 5000;
  try {
    const response = await fetch('/api/live-feed' + (liveCursor ? '?after=' + encodeURIComponent(liveCursor) : ''), { credentials:'same-origin', cache:'no-store', signal:liveController.signal });
    if (response.status === 401) { liveStarted = false; byId('live-status').textContent = 'Session expired. Sign in again to resume updates.'; location.assign('/login'); return; }
    if (!response.ok) throw new Error('Feed unavailable');
    const result = await response.json();
    if (!liveViewActive || livePaused || document.hidden) return;
    renderLiveItems(result, !liveCursor); liveCursor = result.cursor; liveFailures = 0;
    byId('live-status').textContent = (result.more ? 'Catching up on published reports' : 'Connected — checking every 5 seconds') + ' · Last checked: ' + new Date(result.checkedAt).toLocaleTimeString();
  } catch {
    if (liveViewActive && !livePaused && !document.hidden) { liveFailures++; delay = Math.min(30000, 5000 * 2 ** Math.min(liveFailures,3)); byId('live-status').textContent = 'Connection interrupted — displayed reports may be stale. Retrying automatically.'; }
  } finally {
    clearTimeout(timeout); liveRunning = false; liveController = undefined;
    if (liveStarted && liveViewActive && !livePaused && !document.hidden) liveTimer = setTimeout(pollLiveFeed, delay);
  }
}
function startLiveFeed() { liveStarted = true; liveViewActive = true; return pollLiveFeed(); }
function suspendLiveFeed() { liveViewActive = false; clearTimeout(liveTimer); liveController?.abort(); }
byId('live-toggle').addEventListener('click', () => {
  livePaused = !livePaused; clearTimeout(liveTimer); liveController?.abort();
  byId('live-toggle').textContent = livePaused ? 'Resume display updates' : 'Pause display updates';
  byId('live-status').textContent = livePaused ? 'Display updates paused. Background reporting is unchanged.' : 'Reconnecting…';
  if (!livePaused && liveViewActive) void pollLiveFeed();
});
document.addEventListener('visibilitychange', () => {
  clearTimeout(liveTimer);
  if (document.hidden) { liveController?.abort(); byId('live-status').textContent = 'Display updates suspended while this tab is hidden.'; }
  else if (!livePaused && liveViewActive) void pollLiveFeed();
});
window.addEventListener('pagehide', () => { liveStarted = false; clearTimeout(liveTimer); liveController?.abort(); });
window.addEventListener('pageshow', event => { if (event.persisted && !byId('settings').hidden && !byId('view-alerts').hidden) void startLiveFeed(); });
`;

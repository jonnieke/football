export const leagueHtml = `<section aria-labelledby="league-heading">
<div class="toolbar"><h2 id="league-heading">League coverage</h2><button id="league-reload" class="secondary">Reload leagues</button></div>
<p>Choose the leagues and seasons to report automatically. No per-event approval is needed for eligible fresh events.</p>
<p class="hint">Enabled means selected, not proof that workers are running. Changes affect the next polling cycle. A request already in progress may finish; pausing blocks new automatic publication after the pause is saved. Previously published reports remain visible.</p>
<div id="league-list"></div><button id="league-more" class="secondary" hidden>Load more leagues</button>
<h3>Add a league season</h3><p class="hint">Use the league ID and season start year from API-Football (for example, Premier League: ID 39, season 2026 for 2026/27). This form saves your selection; it does not verify provider coverage or your subscription. Add a new season separately rather than changing historical fixtures.</p>
<form id="league-add"><label for="league-name">League name</label><input id="league-name" type="text" maxlength="120" required>
<label for="league-source">API-Football league ID</label><input id="league-source" type="text" inputmode="numeric" pattern="[1-9][0-9]{0,8}" required>
<label for="league-season">Season start year</label><input id="league-season" type="number" min="2000" max="2100" step="1" required>
<button>Add paused league</button></form>
<details><summary>League change history (latest 50)</summary><button id="league-history-reload" class="secondary">Reload history</button><div id="league-history"></div></details></section>`;

export const leagueScript = `
let leagueCursor;
function leagueCard(item) {
  const card = document.createElement('article'); card.className = 'recipient';
  const title = document.createElement('h3'); title.textContent = item.name + ' · ' + item.season;
  const state = document.createElement('p'); state.textContent = (item.enabled ? 'Enabled' : 'Paused') + ' · API-Football ID ' + item.sourceId;
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.textContent = item.enabled ? 'Pause coverage' : 'Enable automatic reporting';
  toggle.addEventListener('click', () => {
    if (!confirm((item.enabled ? 'Pause' : 'Enable automatic') + ' coverage for ' + item.name + ' (' + item.season + ')?' + (item.enabled ? '' : ' Running workers will report eligible fresh events without approval and use your API allowance.'))) return;
    busy(toggle, async () => {
      const result = await api('/api/competitions', { action:'set-enabled', id:item.id, version:item.coverageVersion, enabled:!item.enabled });
      card.replaceWith(leagueCard(result.item));
      notice(result.item.enabled ? 'League enabled. Running workers pick up the selection on their next polling cycle.' : 'League paused. Existing reports have been retained.');
      await Promise.all([loadLeagueHistory(),loadDashboard()]);
    });
  });
  card.append(title,state,toggle); return card;
}
async function loadLeagues(reset = true) {
  const result = await api('/api/competitions' + (!reset && leagueCursor ? '?after=' + encodeURIComponent(leagueCursor) : ''));
  if (reset) byId('league-list').replaceChildren();
  for (const item of result.items) byId('league-list').append(leagueCard(item));
  if (reset && result.items.length === 0) { const empty = document.createElement('p'); empty.textContent = 'No league seasons configured. Add one below.'; byId('league-list').append(empty); }
  leagueCursor = result.items.at(-1)?.id; byId('league-more').hidden = result.items.length < 100;
}
async function loadLeagueHistory() {
  const result = await api('/api/competitions/history'); byId('league-history').replaceChildren();
  for (const item of result.items) { const row = document.createElement('p'); row.textContent = new Date(item.createdAt).toLocaleString() + ' · ' + item.actor + ' · ' + item.action + ' · ' + item.after.name + ' (' + item.after.season + ', ID ' + item.after.sourceId + ')'; byId('league-history').append(row); }
  if (!result.items.length) byId('league-history').textContent = 'No league changes recorded yet.';
}
byId('league-add').addEventListener('submit', event => { event.preventDefault(); busy(event.submitter, async () => {
  await api('/api/competitions', { action:'add', name:byId('league-name').value, sourceId:byId('league-source').value.trim(), season:Number(byId('league-season').value) });
  event.target.reset(); notice('League season added in paused mode. Enable it when ready.'); await Promise.all([loadLeagues(),loadLeagueHistory()]);
}); });
byId('league-reload').addEventListener('click', event => busy(event.target, () => loadLeagues()));
byId('league-more').addEventListener('click', event => busy(event.target, () => loadLeagues(false)));
byId('league-history-reload').addEventListener('click', event => busy(event.target, () => loadLeagueHistory()));
`;
export const leagueCss = `#league-add input{display:block;width:100%;max-width:480px;border:1px solid #aabdb0;padding:12px;border-radius:6px;margin:7px 0 18px;font:inherit}#league-history{overflow-wrap:anywhere}details{margin-top:24px}summary{cursor:pointer;margin-bottom:12px}`;

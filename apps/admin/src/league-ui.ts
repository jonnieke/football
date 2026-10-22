/** API-Football IDs are kept here so administrators never need to look them up. */
export const popularLeagues = [
  { name: "Premier League", country: "England", sourceId: "39" },
  { name: "La Liga", country: "Spain", sourceId: "140" },
  { name: "Bundesliga", country: "Germany", sourceId: "78" },
  { name: "Serie A", country: "Italy", sourceId: "135" },
  { name: "Ligue 1", country: "France", sourceId: "61" },
  { name: "UEFA Champions League", country: "Europe", sourceId: "2" },
] as const;

export const leagueHtml = `<section aria-labelledby="league-heading">
<div class="toolbar"><h2 id="league-heading">League coverage</h2><button id="league-reload" class="secondary">Reload leagues</button></div>
<p>Choose the leagues and seasons to report automatically. No per-event approval is needed for eligible fresh events.</p>
<p class="hint">Enabled means selected, not proof that workers are running. Changes affect the next polling cycle. A request already in progress may finish; pausing blocks new automatic publication after the pause is saved. Previously published reports remain visible.</p>
<h3>Add a league season</h3><p>Tick the major leagues you want to report. Their API-Football IDs are filled in automatically.</p>
<form id="popular-league-form"><label for="popular-season">Season starting year</label><input id="popular-season" type="number" min="2000" max="2100" step="1" value="2026" required><p class="hint">For example, 2026 means the 2026/27 European season. Choose a different year before ticking leagues if needed.</p>
<div id="popular-league-list" class="popular-league-list"></div><button>Enable selected leagues</button></form>
<p class="hint">New selections begin automatic reporting after confirmation. API-Football coverage for each league and season is not verified here; check provider coverage before relying on alerts. More selected leagues can use more of your shared API allowance.</p>
<details id="configured-leagues"><summary>Manage configured leagues</summary><div id="league-list"></div><button id="league-more" class="secondary" hidden>Load more leagues</button></details>
<details><summary>Advanced: add another league by ID</summary><p class="hint">For leagues not in the checklist, use the API-Football league ID and season start year. This form adds the league paused; enable it above when ready. It does not verify provider coverage.</p>
<form id="league-add"><label for="league-name">League name</label><input id="league-name" type="text" maxlength="120" required>
<label for="league-source">API-Football league ID</label><input id="league-source" type="text" inputmode="numeric" pattern="[1-9][0-9]{0,8}" required>
<label for="league-season">Season start year</label><input id="league-season" type="number" min="2000" max="2100" step="1" required>
<button>Add paused league</button></form></details>
<details id="league-history-panel"><summary>League change history (latest 50)</summary><button id="league-history-reload" class="secondary">Reload history</button><div id="league-history"></div></details></section>`;

export const leagueScript = `
const popularLeagues = ${JSON.stringify(popularLeagues)};
let leagueCursor;
let configuredLeagues = [];
function renderPopularLeagues() {
  const season = Number(byId('popular-season').value);
  const list = byId('popular-league-list'); list.replaceChildren();
  for (const league of popularLeagues) {
    const existing = configuredLeagues.find(item => item.sourceId === league.sourceId && item.season === season);
    const label = document.createElement('label'); label.className = 'popular-league';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.name = 'popular-league'; checkbox.value = league.sourceId;
    checkbox.checked = !!existing?.enabled; checkbox.disabled = !!existing?.enabled;
    checkbox.disabled = checkbox.disabled || currentRole === 'viewer';
    const description = document.createElement('span'); description.textContent = league.name + ' · ' + league.country + ' · ' + season + (existing ? (existing.enabled ? ' · Enabled' : ' · Paused') : ' · Not added');
    label.append(checkbox, description); list.append(label);
  }
}
function leagueCard(item) {
  const card = document.createElement('article'); card.className = 'recipient';
  const title = document.createElement('h3'); title.textContent = item.name + ' · ' + item.season;
  const state = document.createElement('p'); state.textContent = (item.enabled ? 'Enabled' : 'Paused') + ' · API-Football ID ' + item.sourceId;
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.textContent = item.enabled ? 'Pause coverage' : 'Enable automatic reporting';
  toggle.disabled = currentRole === 'viewer';
  toggle.addEventListener('click', () => {
    if (!confirm((item.enabled ? 'Pause' : 'Enable automatic') + ' coverage for ' + item.name + ' (' + item.season + ')?' + (item.enabled ? '' : ' Running workers will report eligible fresh events without approval and use your API allowance.'))) return;
    busy(toggle, async () => {
      const result = await api('/api/competitions', { action:'set-enabled', id:item.id, version:item.coverageVersion, enabled:!item.enabled });
      card.replaceWith(leagueCard(result.item));
      configuredLeagues = configuredLeagues.map(current => current.id === item.id ? result.item : current); renderPopularLeagues();
      notice(result.item.enabled ? 'League enabled. Running workers pick up the selection on their next polling cycle.' : 'League paused. Existing reports have been retained.');
      await Promise.all([loadLeagueHistory(),loadDashboard()]);
    });
  });
  card.append(title,state,toggle); return card;
}
async function loadLeagues(reset = true) {
  const result = await api('/api/competitions' + (!reset && leagueCursor ? '?after=' + encodeURIComponent(leagueCursor) : ''));
  if (reset) { byId('league-list').replaceChildren(); configuredLeagues = []; }
  configuredLeagues.push(...result.items);
  for (const item of result.items) byId('league-list').append(leagueCard(item));
  if (reset && result.items.length === 0) { const empty = document.createElement('p'); empty.textContent = 'No league seasons configured. Select one below.'; byId('league-list').append(empty); }
  leagueCursor = result.items.at(-1)?.id; byId('league-more').hidden = result.items.length < 100;
  renderPopularLeagues();
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
byId('popular-league-form').addEventListener('submit', event => { event.preventDefault();
  const season = Number(byId('popular-season').value);
  const selected = Array.from(byId('popular-league-list').querySelectorAll('input[name="popular-league"]:checked:not(:disabled)')).map(input => popularLeagues.find(league => league.sourceId === input.value));
  if (!selected.length) { notice('Tick at least one league that is not already enabled.'); return; }
  if (!confirm('Enable automatic reporting for ' + selected.map(league => league.name).join(', ') + ' (' + season + ')? Running workers will use your shared API-Football allowance.')) return;
  busy(event.submitter, async () => {
    let enabled = 0;
    try {
      for (const league of selected) {
        let item = configuredLeagues.find(current => current.sourceId === league.sourceId && current.season === season);
        if (!item) { const added = await api('/api/competitions', { action:'add', name:league.name, sourceId:league.sourceId, season }); item = added.item; }
        if (!item.enabled) await api('/api/competitions', { action:'set-enabled', id:item.id, version:item.coverageVersion, enabled:true });
        enabled++;
      }
    } catch (error) {
      await Promise.all([loadLeagues(),loadLeagueHistory(),loadDashboard()]);
      throw new Error('Enabled ' + enabled + ' of ' + selected.length + ' selected leagues. Reload and retry the remaining selections. ' + (error.message || 'Request failed'));
    }
    await Promise.all([loadLeagues(),loadLeagueHistory(),loadDashboard()]);
    notice('Enabled ' + enabled + ' league' + (enabled === 1 ? '' : 's') + '. Running workers pick up selections on their next polling cycle.');
  });
});
byId('popular-season').addEventListener('change', renderPopularLeagues);
byId('league-reload').addEventListener('click', event => busy(event.target, () => loadLeagues()));
byId('league-more').addEventListener('click', event => busy(event.target, () => loadLeagues(false)));
byId('league-history-reload').addEventListener('click', event => busy(event.target, () => loadLeagueHistory()));
renderPopularLeagues();
`;
export const leagueCss = `#league-add input,#popular-season{display:block;width:100%;max-width:480px;border:1px solid #aabdb0;padding:12px;border-radius:6px;margin:7px 0 18px;font:inherit}.popular-league-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin:16px 0}.popular-league{display:flex;align-items:center;gap:10px;border:1px solid #d2dfd4;border-radius:7px;padding:12px;cursor:pointer}.popular-league input{width:18px;height:18px;flex:none}.popular-league:has(input:disabled){background:#f3f7f3;cursor:default}#league-history{overflow-wrap:anywhere}details{margin-top:24px}summary{cursor:pointer;margin-bottom:12px}`;

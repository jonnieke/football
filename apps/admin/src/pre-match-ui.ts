export const preMatchHtml = `<section aria-labelledby="pre-match-heading">
<div class="toolbar">
  <div>
    <h2 id="pre-match-heading">Pre-Match Score Notification Approvals</h2>
    <p class="hint">Regulators permit a maximum of 4 notifications per game. We push only scores (no red cards, yellow cards, or duration alerts). After midnight EAT, next-day matches refresh automatically.</p>
  </div>
  <button id="pre-match-refresh" class="secondary">Refresh matches</button>
</div>
<div class="pm-quota-bar">
  <div class="pm-metric">
    <span class="pm-metric-label">Matches approved</span>
    <span id="pm-approved-count" class="pm-metric-value pm-pill">0</span>
  </div>
  <div class="pm-metric">
    <span class="pm-metric-label">Per-game limit</span>
    <span class="pm-metric-value pm-pill">Max 4 Scores</span>
  </div>
  <div class="pm-metric">
    <span class="pm-metric-label">Scores pushed today</span>
    <span id="pm-pushed-count" class="pm-metric-value pm-pill">0</span>
  </div>
  <div class="pm-metric">
    <span class="pm-metric-label">Next regulatory reset</span>
    <span id="pm-reset-timer" class="pm-metric-value">Midnight EAT</span>
  </div>
</div>
<div class="pm-date-row">
  <label for="pre-match-date">Match date (East Africa Time · UTC+3)</label>
  <input id="pre-match-date" type="date">
</div>
<p id="pre-match-status" role="status" aria-live="polite"></p>
<div id="pre-match-list"></div>
</section>`;

export const preMatchCss = `.pm-quota-bar{display:flex;gap:20px;margin:16px 0;padding:14px 18px;background:#f4f6f1;border:1px solid #cddbcf;border-radius:10px;flex-wrap:wrap}.pm-metric{display:flex;flex-direction:column;gap:3px}.pm-metric-label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#64796b;font-weight:700}.pm-metric-value{font-size:17px;font-weight:800;color:#173d2f}.pm-pill{display:inline-block;padding:2px 10px;border-radius:99px;background:#e2ede2;color:#24553d}.pm-pill-active{background:#fdf2dc;color:#8f5b11}.pm-pill-full{background:#fae8e6;color:#a03b32}.pm-date-row{margin:14px 0}.pm-match-card{border:1px solid #d5ded4;border-radius:10px;padding:16px 20px;margin:14px 0;background:#fff}.pm-match-header{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:12px}.pm-match-title{margin:0;font-size:17px;font-weight:700;color:#18352d}.pm-match-meta{margin:0;font-size:13px;color:#536b5d}.pm-match-progress{font-size:13px;font-weight:700;display:inline-flex;align-items:center;gap:6px}.pm-options-grid{display:flex;flex-wrap:wrap;gap:12px 18px;padding:12px 0 4px;border-top:1px solid #f0f3ee}.pm-option-item{display:inline-flex;align-items:center;font-size:14px;font-weight:600;cursor:pointer;padding:6px 12px;border-radius:6px;background:#fafbfa;border:1px solid #dcdfd9;user-select:none;transition:background .15s}.pm-option-item:hover:not(.pm-greyed){background:#edf3ce;border-color:#b5c97d}.pm-option-item input[type=checkbox]{margin-right:8px;accent-color:#24553d;cursor:pointer;width:16px;height:16px}.pm-option-item.pm-greyed{opacity:.45;cursor:not-allowed;background:#f0f2ef;border-color:#e0e4dd;color:#859489}.pm-option-item.pm-greyed input[type=checkbox]{cursor:not-allowed}.pm-game-limit-banner{margin-top:8px;padding:6px 10px;background:#fae8e6;color:#a03b32;font-size:12px;font-weight:700;border-radius:6px}`;

export const preMatchScript = `
let preMatchTimer, preMatchActive=false, preMatchBusy=false, preMatchSaving=false;
function getTodayEAT() {
  const d = new Date(Date.now() + 3 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
byId('pre-match-date').value = getTodayEAT();
function updateResetTimer() {
  const now = new Date();
  const eatNow = new Date(now.getTime() + 3 * 3600 * 1000);
  const midnightEAT = new Date(eatNow);
  midnightEAT.setUTCHours(24, 0, 0, 0);
  const diffMs = midnightEAT.getTime() - eatNow.getTime();
  const hours = Math.floor(diffMs / 3600000);
  const minutes = Math.floor((diffMs % 3600000) / 60000);
  const timerEl = byId('pm-reset-timer');
  if (timerEl) timerEl.textContent = 'Midnight EAT (in ' + hours + 'h ' + minutes + 'm)';
}
async function loadPreMatch() {
  clearTimeout(preMatchTimer);
  if (!preMatchActive || document.hidden || preMatchBusy || preMatchSaving) return;
  preMatchBusy = true;
  updateResetTimer();
  const todayEAT = getTodayEAT();
  const dateInput = byId('pre-match-date');
  if (dateInput.dataset.lastToday && dateInput.dataset.lastToday !== todayEAT) {
    dateInput.value = todayEAT;
    notice('Midnight EAT reached: Displaying matches and fresh score counters for the new day (' + todayEAT + ').');
  }
  dateInput.dataset.lastToday = todayEAT;
  const date = dateInput.value;
  try {
    const result = await api('/api/pre-match?date=' + encodeURIComponent(date));
    if (!preMatchActive || date !== dateInput.value) return;
    const approvedBadge = byId('pm-approved-count');
    approvedBadge.textContent = result.approvedMatchesCount + ' of ' + result.totalMatches;
    const pushedBadge = byId('pm-pushed-count');
    pushedBadge.textContent = String(result.pushedTodayCount || 0);
    const list = byId('pre-match-list');
    list.replaceChildren();
    if (!result.items.length) {
      list.textContent = 'No matches found for this date (' + date + ') in your enabled leagues. Fixtures appear after the next schedule fetch.';
    }
    for (const item of result.items) {
      const card = document.createElement('article');
      card.className = 'pm-match-card';
      const header = document.createElement('div');
      header.className = 'pm-match-header';
      const heading = document.createElement('h3');
      heading.className = 'pm-match-title';
      heading.textContent = item.homeTeam.name + ' ' + item.homeScore + ' – ' + item.awayScore + ' ' + item.awayTeam.name;
      const meta = document.createElement('p');
      meta.className = 'pm-match-meta';
      const kickoff = new Date(item.kickoffAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      meta.textContent = item.competition.name + ' · ' + item.status.replaceAll('_', ' ') + (item.minute === null ? '' : ' · ' + item.minute + '′') + ' · Kick-off ' + kickoff;
      
      const progress = document.createElement('div');
      progress.className = 'pm-match-progress';
      const pillClass = item.isLimitReached ? 'pm-pill pm-pill-full' : (item.pushedCount > 0 ? 'pm-pill pm-pill-active' : 'pm-pill');
      const pillText = item.isLimitReached ? item.pushedCount + ' / ' + item.maxPerGame + ' pushed (Limit reached)' : item.pushedCount + ' / ' + item.maxPerGame + ' scores pushed';
      const pillSpan = document.createElement('span');
      pillSpan.className = pillClass;
      pillSpan.textContent = pillText;
      progress.append(pillSpan);
      
      header.append(heading, meta);
      card.append(header, progress);

      const grid = document.createElement('div');
      grid.className = 'pm-options-grid';

      // Primary score approval checkbox
      const scoreLabel = document.createElement('label');
      scoreLabel.className = 'pm-option-item' + (item.isLimitReached ? ' pm-greyed' : '');
      const scoreBox = document.createElement('input');
      scoreBox.type = 'checkbox';
      scoreBox.checked = Boolean(item.approved);
      scoreBox.disabled = currentRole === 'viewer' || item.isLimitReached;
      const scoreSpan = document.createElement('span');
      scoreSpan.textContent = '⚽ Push Score Notifications (Max 4)';
      scoreLabel.append(scoreBox, scoreSpan);

      // Optional scorer detail checkbox
      const scorerLabel = document.createElement('label');
      scorerLabel.className = 'pm-option-item' + (item.isLimitReached || !item.approved ? ' pm-greyed' : '');
      const scorerBox = document.createElement('input');
      scorerBox.type = 'checkbox';
      scorerBox.checked = Boolean(item.includeScorer);
      scorerBox.disabled = currentRole === 'viewer' || item.isLimitReached || !item.approved;
      const scorerSpan = document.createElement('span');
      scorerSpan.textContent = '👤 Include Scorer Name';
      scorerLabel.append(scorerBox, scorerSpan);

      grid.append(scoreLabel, scorerLabel);
      card.append(grid);

      if (item.isLimitReached) {
        const banner = document.createElement('div');
        banner.className = 'pm-game-limit-banner';
        banner.textContent = 'Maximum 4 score notifications reached for this game. No further alerts will be pushed.';
        card.append(banner);
      }

      async function updateApproval(detailType, approved) {
        preMatchSaving = true;
        clearTimeout(preMatchTimer);
        for (const box of list.querySelectorAll('input[type=checkbox]')) box.disabled = true;
        try {
          await api('/api/pre-match', {
            date: date,
            fixtureId: item.id,
            detailType: detailType,
            approved: approved
          });
          notice((approved ? 'Enabled ' : 'Disabled ') + (detailType === 'scores' ? 'score alerts' : 'scorer name') + ' for ' + item.homeTeam.name + ' v ' + item.awayTeam.name);
          await loadPreMatch();
        } catch (error) {
          notice(error.message);
          await loadPreMatch();
        } finally {
          preMatchSaving = false;
          if (preMatchActive) preMatchTimer = setTimeout(loadPreMatch, 15000);
        }
      }

      scoreBox.addEventListener('change', () => void updateApproval('scores', scoreBox.checked));
      scorerBox.addEventListener('change', () => void updateApproval('scorer', scorerBox.checked));

      list.append(card);
    }
    byId('pre-match-status').textContent = result.approvedMatchesCount + ' of ' + result.totalMatches + ' matches approved for score notifications · Updated ' + new Date().toLocaleTimeString();
  } catch (error) {
    byId('pre-match-status').textContent = 'Could not refresh pre-match approvals. ' + error.message;
  } finally {
    preMatchBusy = false;
    if (preMatchActive) preMatchTimer = setTimeout(loadPreMatch, 15000);
  }
}
function startPreMatch() { preMatchActive = true; return loadPreMatch(); }
function suspendPreMatch() { preMatchActive = false; clearTimeout(preMatchTimer); }
byId('pre-match-refresh').addEventListener('click', () => void loadPreMatch());
byId('pre-match-date').addEventListener('change', () => void loadPreMatch());
document.addEventListener('visibilitychange', () => { if (!document.hidden && preMatchActive) void loadPreMatch(); });
window.addEventListener('pagehide', suspendPreMatch);
`;

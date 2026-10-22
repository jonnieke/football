export const matchesHtml = `<section aria-labelledby="matches-heading">
<div class="toolbar"><h2 id="matches-heading">Matches & notifications</h2><button id="matches-refresh" class="secondary">Refresh matches</button></div>
<p>Tick a game to send its new alerts to connected API clients. Changes save immediately. Enabled leagues start with all games selected.</p>
<label for="matches-date">Match date (UTC)</label><input id="matches-date" type="date">
<p class="hint">Live games appear regardless of date. Scores refresh every 15 seconds while this screen is open. Unchecking stops future publication; alerts already delivered remain with your developer.</p>
<p id="matches-status" role="status" aria-live="polite"></p><div id="matches-list"></div></section>`;

export const matchesScript = `
let matchesTimer, matchesActive=false, matchesBusy=false, matchesSaving=false;
byId('matches-date').value=new Date().toISOString().slice(0,10);
async function loadMatches() {
  clearTimeout(matchesTimer);
  if(!matchesActive || document.hidden || matchesBusy || matchesSaving) return;
  matchesBusy=true;
  const date=byId('matches-date').value;
  try {
    const result=await api('/api/matches?date='+encodeURIComponent(date));
    if(!matchesActive || date!==byId('matches-date').value) return;
    const list=byId('matches-list'); list.replaceChildren();
    if(!result.items.length) list.textContent='No matches found for this date in your enabled leagues. Choose leagues in the Leagues tab; fixtures appear after the next schedule fetch.';
    for(const item of result.items) {
      const card=document.createElement('article');card.className='content-preview';
      const heading=document.createElement('h3');heading.textContent=item.homeTeam.name+' '+item.homeScore+' – '+item.awayScore+' '+item.awayTeam.name;
      const meta=document.createElement('p');meta.className='hint';meta.textContent=item.competition.name+' · '+item.status.replaceAll('_',' ')+(item.minute===null?'':' · '+item.minute+'′')+' · Kick-off '+new Date(item.kickoffAt).toLocaleString();
      const label=document.createElement('label');const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=item.notificationsEnabled;
      checkbox.disabled=currentRole==='viewer';
      const caption=document.createElement('span');caption.textContent=checkbox.checked?'Send notifications':'Notifications off';label.append(checkbox,caption);
      checkbox.addEventListener('change',async()=>{
        matchesSaving=true; clearTimeout(matchesTimer);
        for(const control of list.querySelectorAll('input')) control.disabled=true;
        try {
          const saved=await api('/api/matches',{id:item.id,version:item.notificationVersion,enabled:checkbox.checked});
          item.notificationVersion=saved.item.notificationVersion;item.notificationsEnabled=saved.item.notificationsEnabled;
          checkbox.checked=item.notificationsEnabled;caption.textContent=checkbox.checked?'Send notifications':'Notifications off';
          notice((checkbox.checked?'Notifications on: ':'Notifications off: ')+item.homeTeam.name+' v '+item.awayTeam.name);
        } catch(error) {checkbox.checked=item.notificationsEnabled;notice(error.message);}
        finally {matchesSaving=false;for(const control of list.querySelectorAll('input')) control.disabled=false;if(matchesActive) matchesTimer=setTimeout(loadMatches,15000);}
      });
      const freshness=document.createElement('p');freshness.className='hint';freshness.textContent=item.lastPolledAt?'Score last checked: '+new Date(item.lastPolledAt).toLocaleTimeString():'Waiting for a score update';
      card.append(heading,meta,label,freshness);list.append(card);
    }
    byId('matches-status').textContent=result.items.filter(item=>item.notificationsEnabled).length+' of '+result.items.length+' displayed games selected · Updated '+new Date(result.checkedAt).toLocaleTimeString()+(result.truncated?' · First 500 matches shown.':'');
  } catch(error) {byId('matches-status').textContent='Could not refresh matches. '+error.message;}
  finally {matchesBusy=false;if(matchesActive) matchesTimer=setTimeout(loadMatches,15000);}
}
function startMatches(){matchesActive=true;return loadMatches();}
function suspendMatches(){matchesActive=false;clearTimeout(matchesTimer);}
byId('matches-refresh').addEventListener('click',()=>void loadMatches());
byId('matches-date').addEventListener('change',()=>void loadMatches());
document.addEventListener('visibilitychange',()=>{if(!document.hidden && matchesActive) void loadMatches();});
window.addEventListener('pagehide',suspendMatches);
`;

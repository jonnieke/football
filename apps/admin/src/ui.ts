import {
  dashboardHtml,
  dashboardCss,
  dashboardScript,
} from "./dashboard-ui.js";
import { contentHtml, contentScript } from "./content-ui.js";
import { leagueHtml, leagueScript, leagueCss } from "./league-ui.js";
import { liveHtml, liveScript } from "./live-ui.js";
import {
  apiAccessHtml,
  apiAccessScript,
  apiAccessCss,
} from "./api-access-ui.js";
import { viewScript, viewCss } from "./view-ui.js";
import { matchesHtml, matchesScript } from "./match-ui.js";
import { usersHtml, usersScript, usersCss } from "./users-ui.js";
export const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Control Room · Football Platform</title><link rel="stylesheet" href="/admin.css"><script src="/admin.js" defer></script></head><body>
<header><a href="/settings" class="brand">FOOTBALL <span>CONTROL ROOM</span></a><span class="badge">ADMINISTRATION</span></header>
<main><p class="eyebrow">PRIVATE / LIVE FOOTBALL API</p><h1>Football control room</h1><p class="intro">Choose games, watch live alerts, and connect your notification service through the API.</p><p id="notice" role="status" aria-live="polite"></p>
<section id="login" hidden><h2>Sign in</h2><p>Use the email and password provided by your administrator.</p><form id="password-login"><label for="login-email">Email address</label><input id="login-email" type="email" autocomplete="username" required maxlength="254"><label for="login-password">Password</label><input id="login-password" type="password" autocomplete="current-password" required maxlength="128"><button>Sign in</button></form><details><summary>Existing administrator? Request an email sign-in link</summary><form id="login-form"><label for="link-email">Administrator email</label><input id="link-email" type="email" autocomplete="email" required maxlength="254"><button>Send sign-in link</button></form><p class="hint">Use this for original administrator accounts until they have a password set. The link expires after 10 minutes.</p></details></section>
<section id="confirm" hidden><h2>Confirm your sign-in</h2><p>Continue only if you requested this administrator login in this browser.</p><button id="confirm-login">Confirm sign-in</button> <a href="/login">Request a new link</a></section>
<div id="settings" hidden><div class="toolbar"><p>Signed in as <strong id="identity"></strong></p><button id="logout" class="secondary">Sign out</button></div>
<nav class="product-nav" aria-label="Control room views" role="tablist"><button type="button" role="tab" id="tab-alerts" aria-controls="view-alerts" aria-selected="true">Live alerts</button><button type="button" role="tab" id="tab-matches" aria-controls="view-matches" aria-selected="false">Matches</button><button type="button" role="tab" id="tab-leagues" aria-controls="view-leagues" aria-selected="false">Leagues</button><button type="button" role="tab" id="tab-api" aria-controls="view-api" aria-selected="false">API access</button><button type="button" role="tab" id="tab-inboxes" aria-controls="view-inboxes" aria-selected="false">Admin inboxes</button><button type="button" role="tab" id="tab-users" aria-controls="view-users" aria-selected="false" hidden>Team accounts</button><button type="button" role="tab" id="tab-more" aria-controls="view-more" aria-selected="false">More</button></nav>
<div id="view-alerts" class="view-panel" role="tabpanel" aria-labelledby="tab-alerts">${liveHtml}</div>
<div id="view-matches" class="view-panel" role="tabpanel" aria-labelledby="tab-matches" hidden>${matchesHtml}</div>
<div id="view-api" class="view-panel" role="tabpanel" aria-labelledby="tab-api" hidden>${apiAccessHtml}</div>
<div id="view-leagues" class="view-panel" role="tabpanel" aria-labelledby="tab-leagues" hidden>${leagueHtml}</div>
<div id="view-users" class="view-panel" role="tabpanel" aria-labelledby="tab-users" hidden>${usersHtml}</div>
<div id="view-inboxes" class="view-panel" role="tabpanel" aria-labelledby="tab-inboxes" hidden>
<section><div class="toolbar"><h2>Administrator alert inboxes</h2><button id="reload" class="secondary">Reload list</button></div><p>Only addresses approved for administrator sign-in can receive match alerts. An address listed here does not itself grant sign-in access.</p><p class="hint">Email sending requires the separate worker, which is not yet enabled. Editing, disabling or removing an address cancels its remaining queued alerts, except a send already in progress.</p><div id="recipients"></div><button id="more" class="secondary" hidden>Load more recipients</button></section>
<section><h2>Add an administrator inbox</h2><form id="add-form"><label for="new-email">Approved administrator email</label><input id="new-email" type="email" autocomplete="off" maxlength="254" required><fieldset><legend>Notification preferences</legend><label><input type="checkbox" name="enabled" checked> Enabled</label><label><input type="checkbox" name="warnings" checked> Warnings</label><label><input type="checkbox" name="critical" checked> Critical issues</label><label><input type="checkbox" name="recovery" checked> Recovery</label></fieldset><button>Add inbox</button></form></section>
<section id="history-panel" hidden><h2>Change history</h2><p class="hint">Latest 100 changes, including previous addresses.</p><pre id="history"></pre></section></div>
<div id="view-more" class="view-panel" role="tabpanel" aria-labelledby="tab-more" hidden><section class="more-intro"><h2>More tools</h2><p>Open a category only when you need deeper operational or technical information.</p></section>
<details id="more-ops" class="tool-group"><summary>Platform status and data</summary>${dashboardHtml}</details>
<details id="more-content" class="tool-group"><summary>Historical and withheld reports</summary>${contentHtml}</details>
<details id="more-email" class="tool-group"><summary>Email delivery history</summary><section><div class="toolbar"><h2>Recent match email activity</h2><button id="email-reload" class="secondary">Refresh email status</button></div><p class="hint">Latest 50 deliveries. Accepted means Resend accepted the request, not confirmed inbox delivery. Pending can mean the sender is stopped or waiting to retry.</p><div id="email-activity" role="status"></div></section></details></div>
</div><noscript>JavaScript is required for secure sign-in and settings changes.</noscript></main><footer>Football Platform · Restricted operator access</footer></body></html>`;
export const stylesheet = `:root{font:16px/1.5 system-ui,sans-serif;color:#18352d;background:#f3f5ef}*{box-sizing:border-box}body{margin:0}header{display:flex;justify-content:space-between;align-items:center;padding:24px 5vw;border-bottom:1px solid #d4ded4;background:#fff}.brand{font-weight:800;color:#173d2f;text-decoration:none;letter-spacing:.04em}.brand span{font-size:11px;display:block;letter-spacing:.2em;color:#64796b}.badge,.eyebrow{font-size:11px;letter-spacing:.16em;font-weight:700}.badge{padding:7px 12px;border:1px solid #cedacd;border-radius:20px}main{max-width:1000px;margin:50px auto;padding:0 24px}h1{font-size:clamp(30px,4vw,48px);line-height:1.12;letter-spacing:-.04em;margin:12px 0}h2{font-size:21px;letter-spacing:-.025em;margin:0 0 8px}.intro{font-size:18px;color:#536b5d;margin-bottom:32px}section{background:#fff;border:1px solid #d5ded4;border-radius:14px;padding:28px;margin:22px 0}section p{color:#536b5d}label{display:block;font-size:14px;font-weight:600}input[type=email],input[type=password],select{display:block;width:100%;max-width:480px;border:1px solid #aabdb0;padding:12px;border-radius:6px;margin:7px 0 18px;font:inherit}button{background:#24553d;color:white;border:1px solid #24553d;padding:10px 16px;border-radius:6px;font:600 14px system-ui;cursor:pointer}button:disabled{opacity:.55;cursor:wait}button.secondary{background:#fff;color:#24553d;border-color:#aabdb0}button.danger{background:#fff;color:#a03b32;border-color:#dab0ac}button:focus-visible,input:focus-visible,a:focus-visible{outline:3px solid #9bb838;outline-offset:3px}.toolbar{display:flex;justify-content:space-between;gap:16px;align-items:center}.hint{font-size:13px;color:#66766a}fieldset{border:0;padding:0;display:flex;gap:18px;flex-wrap:wrap;margin:4px 0 20px}legend{font-size:13px;color:#647567;margin-bottom:10px}input[type=checkbox]{accent-color:#24553d;width:16px;height:16px;vertical-align:middle;margin-right:5px}.recipient{border-top:1px solid #e0e5dc;padding:22px 0 4px}.actions{display:flex;gap:10px;margin-bottom:16px}#notice:not(:empty){padding:14px 18px;background:#edf3ce;border-left:4px solid #789334;border-radius:4px;white-space:pre-wrap}#history{font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f6f1;padding:16px;border-radius:6px}footer{font-size:12px;color:#66766a;padding:24px;text-align:center}a{color:#24553d}.product-nav{display:flex;gap:10px;flex-wrap:wrap;margin:22px 0}.product-nav a{display:inline-block;background:#e7ede5;border:1px solid #cddbcf;padding:10px 14px;border-radius:99px;font-weight:700;text-decoration:none}.product-nav a:hover{background:#d9e8d9}[hidden]{display:none!important}@media(max-width:640px){header{padding:18px 24px}.badge{display:none}main{margin:28px auto;padding:0 16px}section{padding:20px}.toolbar{align-items:flex-start;flex-direction:column}.actions{flex-wrap:wrap}fieldset{gap:12px}}`;
export const browserScript = `"use strict";
const byId = id => document.getElementById(id);
let currentRole = 'viewer';
const notice = text => { byId('notice').textContent = text; };
async function api(path, data) {
  const response = await fetch(path, { method:data === undefined ? 'GET' : 'POST', credentials:'same-origin', cache:'no-store', headers:data === undefined ? {} : { 'Content-Type':'application/json', 'X-Admin-Request':'1' }, ...(data === undefined ? {} : { body:JSON.stringify(data) }) });
  const body = await response.json();
  if (!response.ok) { if (response.status === 401 && path.startsWith('/api/')) location.assign('/login'); throw new Error(body.error || 'Request failed'); }
  return body;
}
async function busy(button, work) { button.disabled = true; try { await work(); } catch (error) { notice(error.message || 'Request failed'); } finally { button.disabled = false; } }
const preferences = ['enabled','warnings','critical','recovery','matchAlerts'];
${usersScript}
async function loadEmailActivity() { const panel = byId('email-activity'); try { const result = await api('/api/match-emails'); panel.replaceChildren(); if (!result.items.length) panel.textContent = 'No match emails queued yet.'; for (const item of result.items) { const row = document.createElement('p'); row.textContent = item.email + ' · ' + item.status + ' · attempts: ' + item.attempts + ' · ' + item.subject + (item.lastErrorCode ? ' · ' + item.lastErrorCode : ''); panel.append(row); } } catch (error) { panel.textContent = 'Email status unavailable. ' + error.message; } }
byId('email-reload').addEventListener('click', event => busy(event.target,loadEmailActivity));
const preferenceLabels = { enabled:'Enabled', warnings:'System warnings', critical:'Critical system issues', recovery:'System recovery', matchAlerts:'Match alerts (automatic reports)' };
const matchLabel = document.createElement('label'); const matchCheckbox = document.createElement('input'); matchCheckbox.type = 'checkbox'; matchCheckbox.name = 'matchAlerts'; matchLabel.append(matchCheckbox,preferenceLabels.matchAlerts); byId('add-form').querySelector('fieldset').append(matchLabel);
function settings(form) { const result = { email:form.querySelector('input[type=email]').value }; for (const name of preferences) result[name] = form.elements.namedItem(name).checked; return result; }
let cursor;
function recipient(item) {
  const form = document.createElement('form'); form.className = 'recipient';
  const label = document.createElement('label'); label.textContent = 'Recipient email'; label.htmlFor = 'email-' + item.id;
  const email = document.createElement('input'); email.type = 'email'; email.id = label.htmlFor; email.value = item.email; email.required = true; email.maxLength = 254; form.append(label,email);
  const fieldset = document.createElement('fieldset'); const legend = document.createElement('legend'); legend.textContent = 'Notification preferences'; fieldset.append(legend);
  for (const name of preferences) { const label = document.createElement('label'); const input = document.createElement('input'); input.type = 'checkbox'; input.name = name; input.checked = Boolean(item[name]); label.append(input,preferenceLabels[name]); fieldset.append(label); } form.append(fieldset);
  const actions = document.createElement('div'); actions.className = 'actions';
  const save = document.createElement('button'); save.textContent = 'Save changes';
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'danger'; remove.textContent = 'Remove';
  const historyButton = document.createElement('button'); historyButton.type = 'button'; historyButton.className = 'secondary'; historyButton.textContent = 'History'; actions.append(save,remove,historyButton); form.append(actions);
  form.addEventListener('submit', event => { event.preventDefault(); busy(save,async () => { const result = await api('/api/recipients',{ action:'update',id:item.id,version:item.version,settings:settings(form) }); item = result.item; notice('Recipient updated.'); }); });
  remove.addEventListener('click', () => { if (!confirm('Remove this recipient? Change history will be retained.')) return; busy(remove,async () => { await api('/api/recipients',{ action:'remove',id:item.id,version:item.version }); form.remove(); notice('Recipient removed.'); }); });
  historyButton.addEventListener('click', () => busy(historyButton,async () => { const result = await api('/api/history/' + item.id); byId('history').textContent = JSON.stringify(result.items,null,2); byId('history-panel').hidden = false; byId('history-panel').scrollIntoView({ behavior:'smooth' }); })); return form;
}
async function load(reset) { const result = await api('/api/recipients' + (!reset && cursor ? '?after=' + encodeURIComponent(cursor) : '')); if (reset) byId('recipients').replaceChildren(); for (const item of result.items) byId('recipients').append(recipient(item)); cursor = result.items.at(-1)?.id; byId('more').hidden = result.items.length < 100; }
byId('password-login').addEventListener('submit', event => { event.preventDefault(); busy(event.submitter,async () => { await api('/auth/password',{ email:byId('login-email').value,password:byId('login-password').value }); location.assign('/settings'); }); });
byId('login-form').addEventListener('submit', event => { event.preventDefault(); busy(event.submitter,async () => { const result = await api('/auth/request',{ email:byId('link-email').value }); notice(result.message); }); });
byId('add-form').addEventListener('submit', event => { event.preventDefault(); busy(event.submitter,async () => { await api('/api/recipients',{ action:'add',settings:settings(event.target) }); event.target.reset(); await load(true); notice('Recipient added.'); }); });
byId('reload').addEventListener('click', event => busy(event.target,() => load(true)));
byId('more').addEventListener('click', event => busy(event.target,() => load(false)));
byId('logout').addEventListener('click', event => busy(event.target,async () => { await api('/auth/logout',{}); location.assign('/login'); }));
${dashboardScript}
${contentScript}
${leagueScript}
${apiAccessScript}
${liveScript}
${matchesScript}
${viewScript}
if (location.pathname === '/auth/confirm') {
  const token = new URLSearchParams(location.hash.slice(1)).get('token'); history.replaceState(null,'','/auth/confirm'); byId('confirm').hidden = false;
  if (!token) { notice('No sign-in token. Request a new login link.'); byId('confirm-login').disabled = true; }
  byId('confirm-login').addEventListener('click', event => busy(event.target,async () => { await api('/auth/redeem',{ token }); location.replace('/settings'); }));
} else if (location.pathname === '/login') byId('login').hidden = false;
else (async () => { const session = await api('/api/session'); currentRole=session.role||'viewer'; byId('identity').textContent = session.email+' · '+({viewer:'View only',editor:'Editor',admin:'Admin'}[currentRole]||currentRole); byId('settings').hidden = false; for (const name of ['api','inboxes']) byId('tab-'+name).hidden=currentRole!=='admin'; byId('tab-users').hidden=currentRole!=='admin'; if(currentRole==='viewer'){ for(const id of ['tab-api','tab-inboxes','tab-users']) byId(id).hidden=true; } await showView(viewFromHash()); })().catch(error => notice(error.message));
`;
export const operationsStylesheet =
  stylesheet + dashboardCss + leagueCss + apiAccessCss + viewCss + usersCss;

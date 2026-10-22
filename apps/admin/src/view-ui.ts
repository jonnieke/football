export const viewScript = `
const controlViews = ['alerts','matches','leagues','api','inboxes','users','more'];
const viewLoads = new Map();
let activeControlView;
function viewFromHash() {
  const value = location.hash.slice(1);
  return controlViews.includes(value) ? value : 'alerts';
}
async function loadControlView(view) {
  if (view === 'alerts') return startLiveFeed();
  if (view === 'matches') return startMatches();
  if (view === 'api') return loadApiClients();
  if (view === 'users') return loadUsers();
  if (view === 'more') return;
  if (!viewLoads.has(view)) {
    const work = view === 'leagues' ? loadLeagues() : load(true);
    viewLoads.set(view, work);
    work.catch(() => viewLoads.delete(view));
  }
  return viewLoads.get(view);
}
async function showView(view) {
  if (!controlViews.includes(view)) view = 'alerts';
  if (activeControlView === 'alerts' && view !== 'alerts') suspendLiveFeed();
  if (activeControlView === 'matches' && view !== 'matches') suspendMatches();
  const changed = activeControlView !== view;
  activeControlView = view;
  for (const name of controlViews) {
    const active = name === view;
    byId('view-' + name).hidden = !active;
    const tab = byId('tab-' + name); tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
  }
  if (changed) await loadControlView(view);
}
for (const name of controlViews) {
  const tab = byId('tab-' + name);
  tab.addEventListener('click', () => {
    if (location.hash === '#' + name) void showView(name).catch(error => notice(error.message));
    else location.hash = name;
  });
  tab.addEventListener('keydown', event => {
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    const next = controlViews[(controlViews.indexOf(name) + direction + controlViews.length) % controlViews.length];
    byId('tab-' + next).focus(); byId('tab-' + next).click();
  });
}
window.addEventListener('hashchange', () => {
  if (!byId('settings').hidden) void showView(viewFromHash()).catch(error => notice(error.message));
});
const technicalLoads = new Map();
const technicalReaders = {
  'more-ops': () => loadDashboard(),
  'more-content': () => Promise.all([loadDrafts(),loadApprovalHistory()]),
  'more-email': () => loadEmailActivity(),
  'league-history-panel': () => loadLeagueHistory(),
};
for (const [id, reader] of Object.entries(technicalReaders)) {
  byId(id).addEventListener('toggle', event => {
    if (!event.target.open || technicalLoads.has(id)) return;
    const work = Promise.resolve().then(reader);
    technicalLoads.set(id, work);
    work.catch(error => { technicalLoads.delete(id); notice(error.message || 'Could not load this view.'); });
  });
}
`;

export const viewCss = `.product-nav{position:sticky;top:0;z-index:5;background:#f3f5ef;padding:10px 0}.product-nav button{background:#fff;color:#24553d;border-color:#cddbcf;border-radius:99px}.product-nav button[aria-selected="true"]{background:#24553d;color:#fff;border-color:#24553d}.view-panel>section:first-child{margin-top:10px}.tool-group{margin:12px 0;border:1px solid #d5ded4;background:#fff;border-radius:12px}.tool-group>summary{padding:18px 22px;cursor:pointer;font-weight:700}.tool-group>section{margin:12px}.more-intro{margin-bottom:12px}@media(max-width:640px){.product-nav{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:thin}.product-nav button{white-space:nowrap;flex:none}.tool-group>summary{padding:16px}}`;

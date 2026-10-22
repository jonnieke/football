export const apiAccessHtml = `<section id="api-access" aria-labelledby="api-access-heading">
<div class="toolbar"><div><p class="eyebrow">DEVELOPER CONNECTION</p><h2 id="api-access-heading">API access</h2></div><button id="api-clients-reload" class="secondary">Refresh clients</button></div>
<p>Generate credentials for your developer to receive automatic live notifications for selected games. A key is shown once; only its hash is stored. Approved administrators can sign in here and generate keys.</p>
<h3>Connect your notification service</h3><ol><li>Generate and copy a key below.</li><li>Open <code>https://api-1lc3.vercel.app/v1/feed/stream</code> from your server with <code>Authorization: Bearer YOUR_API_KEY</code>.</li><li>Read each alert from <code>items[].text.short</code> (maximum 150 characters for new alerts) and deliver it through your service.</li><li>Save each cursor after processing the full batch. Reconnect with <code>Last-Event-ID</code> and deduplicate using each item's <code>id</code>.</li></ol>
<p class="hint">The stream starts with new alerts. Use <code>GET /v1/feed?after=SAVED_CURSOR</code> to catch up after a disconnect. The connection rotates regularly; reconnect automatically. Your server initiates an outbound HTTPS connection, so your private database needs no public access. Selecting matches governs future publication; previously published alerts remain in history. Keep API keys on your server.</p>
<form id="api-client-create"><label for="api-client-name">Client or partner name</label><input id="api-client-name" type="text" maxlength="100" minlength="2" required placeholder="e.g. Ball Mtaani newsroom"><label for="api-client-rate">Requests per minute</label><input id="api-client-rate" type="number" min="1" max="1000" value="120" required><button>Generate API key</button></form>
<div id="new-api-key" class="key-once" hidden><strong>Copy this key now — it will not be shown again.</strong><code id="new-api-key-value"></code><button id="copy-api-key" class="secondary" type="button">Copy key</button><p class="hint">Treat it like a password. Do not put it in a slide, screenshot, or public document.</p></div>
<h3>Issued clients</h3><div id="api-client-list" role="status"></div>
<p class="hint">Revoking a key blocks its next authenticated request. To replace a lost key, create a new one, update your client, then revoke the old one.</p></section>`;

export const apiAccessScript = `
function apiClientCard(item) {
  const card=document.createElement('article'); card.className='recipient';
  const title=document.createElement('h3'); title.textContent=item.name;
  const meta=document.createElement('p'); meta.className='hint'; meta.textContent=item.slug+' · '+item.status+' · key '+item.keyPrefix+'… · '+item.rateLimit+' requests/minute';
  card.append(title,meta);
  if(item.status==='enabled' && !item.revokedAt) {
    const revoke=document.createElement('button'); revoke.type='button'; revoke.className='danger'; revoke.textContent='Revoke key';
    revoke.addEventListener('click',()=>{
      if(!confirm('Revoke API access for '+item.name+'? This cannot be undone.')) return;
      busy(revoke,async()=>{await api('/api/clients',{action:'revoke',id:item.id});notice('Key revoked.');await loadApiClients();});
    }); card.append(revoke);
  }
  return card;
}
async function loadApiClients(){
  const result=await api('/api/clients'); const list=byId('api-client-list'); list.replaceChildren();
  if(!result.items.length){list.textContent='No API clients yet. Generate a key above when you are ready.';return;}
  for(const item of result.items) list.append(apiClientCard(item));
}
byId('api-clients-reload').addEventListener('click',event=>busy(event.target,loadApiClients));
byId('api-client-create').addEventListener('submit',event=>{event.preventDefault();busy(event.submitter,async()=>{
  byId('new-api-key').hidden=true;byId('new-api-key-value').textContent='';
  const result=await api('/api/clients',{action:'create',name:byId('api-client-name').value,rateLimit:Number(byId('api-client-rate').value)});
  byId('new-api-key-value').textContent=result.plaintext;byId('new-api-key').hidden=false;
  event.target.reset();notice('API key created. Copy it before leaving this page.');await loadApiClients();
});});
byId('copy-api-key').addEventListener('click',event=>busy(event.target,async()=>{
  const value=byId('new-api-key-value').textContent;
  if(!value) throw new Error('No new key to copy.');
  await navigator.clipboard.writeText(value);notice('Key copied. Store it securely.');
}));
`;

export const apiAccessCss = `#api-client-create input{display:block;width:100%;max-width:480px;border:1px solid #aabdb0;padding:12px;border-radius:6px;margin:7px 0 18px;font:inherit}.key-once{border:1px solid #c2d0a2;background:#f3f7e8;padding:20px;border-radius:10px;margin:20px 0}.key-once code{display:block;overflow-wrap:anywhere;margin:14px 0;padding:14px;background:#fff;border:1px solid #d9e0d0;border-radius:6px;font-size:14px}`;

export const usersHtml = `<section><div class="toolbar"><div><p class="eyebrow">ACCESS CONTROL</p><h2>Team accounts</h2></div><button id="users-reload" class="secondary">Refresh accounts</button></div><p>Create a login, set its password, and choose what the person can do.</p><form id="user-create"><label for="user-email">Email address</label><input id="user-email" type="email" autocomplete="off" maxlength="254" required><label for="user-password">Temporary password (at least 12 characters)</label><input id="user-password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required><label for="user-role">Access level</label><select id="user-role"><option value="viewer">View only</option><option value="editor">Editor</option><option value="admin">Admin</option></select><p class="hint">Share the password privately. The user can sign in immediately; an admin can reset it here later. To give an original administrator password access, enter their email above and select Admin.</p><button>Create account</button></form><h3>Accounts</h3><div id="user-list" role="status"></div><h3>Existing email-link administrators</h3><p class="hint">These original accounts keep email-link sign-in until you set a password for them above.</p><div id="configured-admin-list"></div></section>`;

export const usersScript = `
const accountRoleLabels={viewer:'View only',editor:'Editor',admin:'Admin'};
function makeAccountRow(user,allowEdit=true){
 const row=document.createElement('article');row.className='recipient';
 const title=document.createElement('strong');title.textContent=user.email;
 const meta=document.createElement('p');meta.className='hint';meta.textContent=(user.configured?'Email-link account':'Password account')+' · '+accountRoleLabels[user.role]+' · '+(user.disabled?'Disabled':'Active');
 row.append(title,meta);
 if(!allowEdit)return row;
 const form=document.createElement('form');form.className='user-edit';
 const role=document.createElement('select');for(const [value,label] of Object.entries(accountRoleLabels)){const option=document.createElement('option');option.value=value;option.textContent=label;option.selected=value===user.role;role.append(option)}if(user.configured)role.disabled=true;
 const password=document.createElement('input');password.type='password';password.autocomplete='new-password';password.minLength=12;password.maxLength=128;password.placeholder='New password (optional)';
 const disabledLabel=document.createElement('label');const disabled=document.createElement('input');disabled.type='checkbox';disabled.checked=user.disabled;disabled.disabled=Boolean(user.configured);disabledLabel.append(disabled,' Disable account');
 const save=document.createElement('button');save.textContent='Save access';form.append(role,password,disabledLabel,save);
 form.addEventListener('submit',event=>{event.preventDefault();busy(save,async()=>{await api('/api/users',{action:'update',email:user.email,role:role.value,disabled:disabled.checked,...(password.value?{password:password.value}:{})});notice('Account updated.');await loadUsers()})});row.append(form);return row;
}
async function loadUsers(){const result=await api('/api/users');const list=byId('user-list');list.replaceChildren();if(!result.users.length)list.textContent='No password accounts yet.';for(const user of result.users)list.append(makeAccountRow(user));const legacy=byId('configured-admin-list');legacy.replaceChildren();for(const email of result.configuredAdmins)legacy.append(makeAccountRow({email,role:'admin',disabled:false,configured:true},false));}
byId('users-reload').addEventListener('click',event=>busy(event.target,loadUsers));
byId('user-create').addEventListener('submit',event=>{event.preventDefault();busy(event.submitter,async()=>{await api('/api/users',{action:'create',email:byId('user-email').value,role:byId('user-role').value,password:byId('user-password').value});event.target.reset();notice('Account created. Share the password privately.');await loadUsers()})});
`;

export const usersCss = `#user-create input,#user-create select,.user-edit input,.user-edit select{display:block;width:100%;max-width:480px;border:1px solid #aabdb0;padding:12px;border-radius:6px;margin:7px 0 18px;font:inherit}.user-edit{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.user-edit select{width:auto;min-width:150px}.user-edit input[type=password]{margin:0;flex:1}.user-edit label{display:flex;align-items:center}`;

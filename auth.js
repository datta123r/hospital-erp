(() => {
  'use strict';

  const SUPABASE_URL = 'https://krqanolwydmufdjdttfk.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2vE2o6ESY0b-_r87w17xuw_i8a20qNd';
  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const adminRoles = new Set(['super', 'owner', 'hospitalAdmin']);
  const roleNames = Object.fromEntries(roles.map(role => [role.id, role.name]));
  let currentAccess = null;

  function showLogin(message = '') {
    roleGate.classList.remove('hidden');
    app.classList.add('locked');
    roleGate.innerHTML = `<div class="auth-shell"><div class="auth-card">
      <div class="mark">+</div><h1>Sign in to AarogyaOne</h1>
      <p>Use the Google account authorised by your hospital administrator.</p>
      <div class="auth-error ${message ? 'show' : ''}" id="authError">${escapeHtml(message)}</div>
      <button class="google-btn" id="googleLogin"><span class="google-g">G</span> Continue with Google</button>
      <p class="auth-note">Access is controlled by the hospital role directory. Signing in does not grant access automatically.</p>
    </div></div>`;
    document.getElementById('googleLogin').onclick = signIn;
  }

  async function signIn() {
    const button = document.getElementById('googleLogin');
    button.disabled = true;
    button.lastChild.textContent = ' Redirecting…';
    const redirectTo = location.origin + location.pathname;
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, queryParams: { prompt: 'select_account' } }
    });
    if (error) {
      button.disabled = false;
      showLogin(error.message);
    }
  }

  async function authorize(session) {
    const email = session.user.email.toLowerCase();
    const { data: access, error } = await client.from('user_access')
      .select('*').eq('email', email).eq('active', true).maybeSingle();
    if (error || !access) {
      await client.auth.signOut();
      showLogin('This Google account has not been granted access. Contact your hospital administrator.');
      return;
    }

    currentAccess = access;
    const role = roles.find(item => item.id === access.role);
    if (!role) {
      await client.auth.signOut();
      showLogin('Your assigned role is not recognised. Contact your hospital administrator.');
      return;
    }

    window.selectRole(role.id);
    switchRole.style.display = 'none';
    roleUser.textContent = access.full_name || session.user.user_metadata.full_name || email;
    roleName.textContent = role.name;
    roleAvatar.textContent = initials(roleUser.textContent);
    addSessionControls(email);
    configureAdmin(adminRoles.has(access.role));
    await recordLogin(session, access);
  }

  function addSessionControls(email) {
    let logout = document.getElementById('logout');
    if (!logout) {
      logout = document.createElement('button');
      logout.id = 'logout'; logout.className = 'btn secondary'; logout.textContent = 'Sign out';
      document.querySelector('.actions').insertBefore(logout, document.querySelector('.user'));
    }
    logout.style.display = 'inline-block';
    logout.onclick = async () => { await client.auth.signOut(); location.reload(); };
    let label = document.querySelector('.signed-in-email');
    if (!label) {
      label = document.createElement('div'); label.className = 'signed-in-email';
      document.querySelector('.user > div:last-child').appendChild(label);
    }
    label.textContent = email;
  }

  function configureAdmin(isAdmin) {
    let navButton = document.querySelector('[data-page="admin"]');
    if (!navButton) {
      navButton = document.createElement('button');
      navButton.dataset.page = 'admin'; navButton.innerHTML = '<span class="ico">♚</span>User administration';
      document.querySelector('.nav button[data-page="settings"]').before(navButton);
      navButton.onclick = () => { window.page('admin'); loadAdmin(); };
    }
    navButton.style.display = isAdmin ? 'flex' : 'none';
    if (isAdmin && !document.getElementById('admin')) createAdminPage();
  }

  function createAdminPage() {
    const section = document.createElement('section');
    section.className = 'page'; section.id = 'admin';
    section.innerHTML = `<div class="head"><div><h1>User administration</h1><p>Grant Gmail accounts the minimum role required and review sign-in activity.</p></div><button class="btn secondary" id="refreshAdmin">↻ Refresh</button></div>
      <div class="stats" id="authStats"></div>
      <div class="admin-grid" style="margin-top:17px"><div class="card"><div class="cardhead"><div><h2>Add or update user</h2><p>Users receive access after signing in with this Gmail address.</p></div></div>
      <form class="form formgrid" id="accessForm"><div class="field span2"><label>Gmail / Google email *</label><input name="email" type="email" required placeholder="name@gmail.com"></div><div class="field"><label>Full name *</label><input name="full_name" required></div><div class="field"><label>Role *</label><select name="role" required>${roles.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('')}</select></div><div class="field span2"><label>Branch / scope</label><input name="branch" placeholder="e.g. Vijayawada Main Clinic"></div><div class="span2"><button class="btn primary">Save access</button></div></form></div>
      <div class="card"><div class="cardhead"><div><h2>Authorised users</h2><p>Server-enforced access directory</p></div></div><div class="tablewrap"><table class="table"><thead><tr><th>User</th><th>Role</th><th>Scope</th><th>Status</th><th>Action</th></tr></thead><tbody id="accessRows"></tbody></table></div></div></div>
      <div class="card" style="margin-top:17px"><div class="cardhead"><div><h2>Recent sign-ins</h2><p>Authentication analytics and access history</p></div></div><div class="tablewrap"><table class="table"><thead><tr><th>User</th><th>Role</th><th>Signed in</th></tr></thead><tbody id="loginRows"></tbody></table></div></div>`;
    document.querySelector('.content').appendChild(section);
    document.getElementById('refreshAdmin').onclick = loadAdmin;
    document.getElementById('accessForm').onsubmit = saveAccess;
  }

  async function loadAdmin() {
    if (!currentAccess || !adminRoles.has(currentAccess.role)) return;
    const [{ data: users, error: usersError }, { data: logins, error: loginError }] = await Promise.all([
      client.from('user_access').select('*').order('created_at', { ascending: false }),
      client.from('login_events').select('*').order('logged_in_at', { ascending: false }).limit(50)
    ]);
    if (usersError || loginError) return toast('Unable to load admin analytics');
    const sevenDays = Date.now() - 7 * 86400000;
    const recent = logins.filter(item => new Date(item.logged_in_at).getTime() >= sevenDays).length;
    authStats.innerHTML = stat('Authorised users', users.length) + stat('Active accounts', users.filter(u => u.active).length) + stat('Sign-ins · 7 days', recent) + stat('Latest sign-in', logins[0] ? relativeTime(logins[0].logged_in_at) : 'None');
    accessRows.innerHTML = users.map(u => `<tr><td><b>${escapeHtml(u.full_name || 'Unnamed')}</b><small>${escapeHtml(u.email)}</small></td><td>${escapeHtml(roleNames[u.role] || u.role)}</td><td>${escapeHtml(u.branch || 'Organisation')}</td><td><span class="status ${u.active ? 'confirmed' : 'arrived'}">${u.active ? 'Active' : 'Suspended'}</span></td><td class="admin-table-actions"><button data-toggle-email="${escapeHtml(u.email)}" data-active="${u.active}">${u.active ? 'Suspend' : 'Activate'}</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">No authorised users</td></tr>';
    loginRows.innerHTML = logins.map(l => `<tr><td>${escapeHtml(l.email)}</td><td>${escapeHtml(roleNames[l.role] || l.role)}</td><td>${new Date(l.logged_in_at).toLocaleString()}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">No sign-ins recorded yet</td></tr>';
    document.querySelectorAll('[data-toggle-email]').forEach(button => button.onclick = () => toggleAccess(button));
  }

  async function saveAccess(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const record = { email: String(data.get('email')).trim().toLowerCase(), full_name: String(data.get('full_name')).trim(), role: data.get('role'), branch: String(data.get('branch')).trim() || null, active: true, created_by: currentAccess.user_id };
    const { error } = await client.from('user_access').upsert(record, { onConflict: 'email' });
    if (error) return toast(error.message);
    await audit('user_access_saved', record.email, { role: record.role, branch: record.branch });
    event.currentTarget.reset(); toast('User access saved'); loadAdmin();
  }

  async function toggleAccess(button) {
    const email = button.dataset.toggleEmail;
    if (email === currentAccess.email) return toast('You cannot suspend your own account');
    const active = button.dataset.active !== 'true';
    const { error } = await client.from('user_access').update({ active, updated_at: new Date().toISOString() }).eq('email', email);
    if (error) return toast(error.message);
    await audit(active ? 'user_access_activated' : 'user_access_suspended', email, {});
    toast(active ? 'User activated' : 'User suspended'); loadAdmin();
  }

  async function audit(action, entityId, details) {
    const { data: { user } } = await client.auth.getUser();
    if (!user) return;
    await client.from('audit_events').insert({ actor_id: user.id, actor_email: user.email, action, entity_type: 'user_access', entity_id: entityId, details });
  }

  async function recordLogin(session, access) {
    const marker = `login:${session.access_token.slice(-16)}`;
    if (sessionStorage.getItem(marker)) return;
    await client.from('login_events').insert({ user_id: session.user.id, email: session.user.email.toLowerCase(), role: access.role, user_agent: navigator.userAgent.slice(0, 250) });
    sessionStorage.setItem(marker, '1');
  }

  const stat = (label, value) => `<div class="stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`;
  const initials = value => value.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase();
  const relativeTime = value => { const mins = Math.floor((Date.now() - new Date(value).getTime()) / 60000); return mins < 1 ? 'Just now' : mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`; };
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

  showLogin();
  client.auth.getSession().then(({ data: { session } }) => session && authorize(session));
  client.auth.onAuthStateChange((event, session) => { if (event === 'SIGNED_IN' && session) authorize(session); });
})();

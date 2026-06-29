/* ===========================================================
 *  GamePortal SDK — contrat commun à tous les jeux du portail.
 *  Inclure dans une page :
 *     <script src="/config.js"></script>
 *     <script src="/sdk.js"></script>
 *  Puis :
 *     await GamePortal.init({ gameId: 'emberfall' });
 *     GamePortal.submitScore(score, { lvl, kills });
 *     const top = await GamePortal.getLeaderboard({ limit: 20 });
 *
 *  Sans clés Supabase => mode hors-ligne (scores en localStorage).
 * =========================================================== */
(function () {
  const cfg = window.GAMEPORTAL_CONFIG || {};
  const hasCloud = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);

  let sb = null, user = null, profile = null, gameId = null;
  let readyResolve;
  const ready = new Promise((r) => (readyResolve = r));

  async function loadSupabase() {
    if (sb) return sb;
    const m = await import("https://esm.sh/@supabase/supabase-js@2");
    sb = m.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
    return sb;
  }

  const lsKey = (k) => "gp:" + (gameId || "_") + ":" + k;

  // ---------- analytics (privé, en écriture seule) ----------
  function sid(){
    try {
      let s = sessionStorage.getItem('gp:sid');
      if (!s) { s = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('gp:sid', s); }
      return s;
    } catch (e) { return 'nosession'; }
  }
  async function track(name, props){
    if (!sb || !user) return;
    try { await sb.from('events').insert({ user_id: user.id, game_id: gameId, name, props: props || {}, session_id: sid() }); }
    catch (e) { /* l'analytics ne doit jamais casser le jeu */ }
  }

  async function init(opts) {
    gameId = (opts && opts.gameId) || "unknown";
    if (!hasCloud) { readyResolve(); return GamePortal; }
    try {
      await loadSupabase();
      let { data: { session } } = await sb.auth.getSession();
      if (!session) {
        const { data, error } = await sb.auth.signInAnonymously();
        if (error) throw error;
        session = data.session;
      }
      user = session.user;
      await loadProfile();
      await loadWallet();
      track('open', { path: (typeof location !== 'undefined' && location.pathname) || '' });
    } catch (e) {
      console.warn("[GamePortal] mode hors-ligne :", e.message);
      sb = null; user = null;
    }
    readyResolve();
    return GamePortal;
  }

  async function loadProfile() {
    if (!sb || !user) return;
    let { data } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (!data) {
      const uname = "Joueur-" + user.id.slice(0, 8).toUpperCase();
      await sb.from("profiles").upsert({ id: user.id, username: uname });
      data = { id: user.id, username: uname };
    }
    profile = data;
    // si un pseudo local existait avant la connexion, on l'adopte
    const local = localStorage.getItem("gp:username");
    if (local && local !== profile.username) await setUsername(local);
  }

  function getUsername() {
    if (profile) return profile.username;
    return localStorage.getItem("gp:username") || "Invité";
  }

  async function setUsername(name) {
    // on retire les chevrons (défense en profondeur anti-XSS) ; l'échappement à l'affichage reste la vraie protection
    name = (name || "").replace(/[<>]/g, "").trim().slice(0, 24);
    if (!name) return { ok: false, error: "Pseudo vide" };
    localStorage.setItem("gp:username", name);
    if (sb && user) {
      const { error } = await sb.from("profiles").update({ username: name }).eq("id", user.id);
      if (!error && profile) profile.username = name;
      return { ok: !error, error: error && error.message };
    }
    return { ok: true };
  }

  async function submitScore(value, meta) {
    value = Math.max(0, Math.floor(value || 0));
    const k = lsKey("best");
    const prev = +(localStorage.getItem(k) || 0);
    if (value > prev) localStorage.setItem(k, value);
    if (!sb || !user) return { ok: true, online: false, best: Math.max(prev, value) };
    try {
      const { error } = await sb.from("scores").insert({
        game_id: gameId, user_id: user.id, value, meta: meta || {}
      });
      if (error) throw error;
      track('score', Object.assign({ value: value }, meta || {}));
      return { ok: true, online: true };
    } catch (e) {
      console.warn("[GamePortal] score non envoyé :", e.message);
      return { ok: false, online: true, error: e.message };
    }
  }

  async function getLeaderboard(o) {
    o = o || {};
    const gid = o.gameId || gameId;
    const limit = o.limit || 20;
    if (!sb) {
      const v = +(localStorage.getItem("gp:" + gid + ":best") || 0);
      return v ? [{ rank: 1, username: getUsername(), value: v, is_me: true }] : [];
    }
    try {
      const { data, error } = await sb
        .from("v_leaderboard").select("*")
        .eq("game_id", gid).order("rank", { ascending: true }).limit(limit);
      if (error) throw error;
      return (data || []).map((r) => ({ ...r, is_me: !!(user && r.user_id === user.id) }));
    } catch (e) {
      console.warn("[GamePortal] classement indisponible :", e.message);
      return [];
    }
  }

  async function getGames() {
    if (!sb) return null;
    try {
      const { data } = await sb.from("games").select("*").eq("enabled", true).order("sort");
      return data;
    } catch (e) { return null; }
  }

  async function saveProgress(key, data) {
    localStorage.setItem(lsKey("prog:" + key), JSON.stringify(data));
    if (sb && user) {
      try { await sb.from("progress").upsert({ user_id: user.id, game_id: gameId, key, data }); }
      catch (e) { /* silencieux : le local fait foi */ }
    }
    return { ok: true };
  }

  async function loadProgress(key) {
    if (sb && user) {
      try {
        const { data } = await sb.from("progress").select("data")
          .eq("user_id", user.id).eq("game_id", gameId).eq("key", key).maybeSingle();
        if (data) return data.data;
      } catch (e) { /* repli local */ }
    }
    const raw = localStorage.getItem(lsKey("prog:" + key));
    return raw ? JSON.parse(raw) : null;
  }

  // ---------- UI partagée (dispo pour tous les jeux) ----------
  let uiInjected = false;
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function injectUI(){
    if (uiInjected) return; uiInjected = true;
    const css = `
.gp-ov{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;
  background:rgba(6,6,12,.7);backdrop-filter:blur(6px);font-family:"Space Grotesk",system-ui,sans-serif}
.gp-modal{width:min(92vw,360px);background:linear-gradient(180deg,#181826,#13131e);
  border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:24px;color:#ece9f5;
  box-shadow:0 30px 90px -40px rgba(255,122,60,.6)}
.gp-h{font-size:20px;font-weight:600}
.gp-sub{color:#8d8aa0;font-size:13px;margin-top:4px}
.gp-input{width:100%;margin-top:16px;background:#0c0c14;border:1px solid rgba(255,255,255,.14);
  border-radius:10px;color:#fff;font:500 15px "Space Grotesk",sans-serif;padding:12px 14px;outline:none}
.gp-input:focus{border-color:#ff7a3c}
.gp-row2{display:flex;gap:10px;margin-top:16px}
.gp-btn{flex:1;cursor:pointer;font:600 14px "Space Grotesk",sans-serif;border:none;border-radius:10px;
  padding:12px;color:#0c0a08;background:linear-gradient(120deg,#ff7a3c,#ffb04d)}
.gp-btn:hover{filter:brightness(1.08)}
.gp-ghost{background:transparent;color:#bfb9d6;border:1px solid rgba(255,255,255,.14)}
.gp-err{color:#ff5d6c;font-size:12px;min-height:16px;margin-top:8px}
.gp-lbtitle{font-family:"JetBrains Mono",monospace;font-size:10.5px;letter-spacing:.16em;
  text-transform:uppercase;color:#8d8aa0;margin-bottom:8px;text-align:center}
.gp-muted{color:#5b5870;font-family:"JetBrains Mono",monospace;font-size:12px;text-align:center;padding:6px}
.gp-row{display:flex;align-items:center;gap:10px;font-family:"JetBrains Mono",monospace;font-size:12.5px;
  padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.06);margin-bottom:5px}
.gp-row .gp-rk{color:#5b5870;width:26px}
.gp-row .gp-name{color:#ece9f5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gp-row .gp-val{margin-left:auto;color:#ffb04d}
.gp-row.gp-me{background:rgba(255,122,60,.10);border-color:rgba(255,122,60,.3)}
.gp-toasts{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:100000;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}
.gp-toast{min-width:210px;max-width:88vw;background:linear-gradient(180deg,#1c1a28,#15131e);border:1px solid rgba(255,176,77,.4);border-radius:12px;padding:10px 16px;color:#ece9f5;font-family:"Space Grotesk",system-ui,sans-serif;box-shadow:0 14px 40px -18px rgba(0,0,0,.85);opacity:0;transform:translateY(12px);transition:opacity .35s,transform .35s;text-align:center}
.gp-toast.in{opacity:1;transform:translateY(0)}
.gp-toast-main{font-weight:600;font-size:14px;display:flex;gap:7px;align-items:center;justify-content:center}
.gp-toast-ic{font-size:15px}
.gp-toast-sub{font-size:11.5px;color:#9c98b0;margin-top:3px}
.gp-toast-ach{border-color:rgba(255,210,122,.75)}
.gp-toast-level{border-color:rgba(159,232,255,.7)}
.gp-toast-coin{border-color:rgba(255,176,77,.55)}
`;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  }

  // Fenêtre de pseudo. Résout avec le nouveau pseudo, ou null si annulé.
  function promptUsername(){
    injectUI();
    return new Promise((resolve) => {
      const ov = document.createElement('div'); ov.className = 'gp-ov';
      ov.innerHTML = `<div class="gp-modal">
        <div class="gp-h">Ton pseudo</div>
        <div class="gp-sub">Visible dans les classements.</div>
        <input class="gp-input" maxlength="24" value="${escapeHtml(getUsername())}">
        <div class="gp-row2"><button class="gp-btn gp-ghost" data-x="cancel">Annuler</button>
          <button class="gp-btn" data-x="ok">Enregistrer</button></div>
        <div class="gp-err"></div></div>`;
      document.body.appendChild(ov);
      const input = ov.querySelector('.gp-input'), err = ov.querySelector('.gp-err');
      input.focus(); input.select();
      const close = (v) => { ov.remove(); resolve(v); };
      ov.querySelector('[data-x="cancel"]').onclick = () => close(null);
      ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(null); });
      async function save(){
        const name = input.value.trim();
        if (!name) { err.textContent = 'Choisis un pseudo.'; return; }
        const r = await setUsername(name);
        if (r.ok) close(getUsername()); else err.textContent = r.error || 'Pseudo indisponible.';
      }
      ov.querySelector('[data-x="ok"]').onclick = save;
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') close(null); });
    });
  }

  // Remplit un élément avec le top N en ligne (+ ta ligne si hors du top).
  async function renderTop(el, opts){
    if (!el) return; injectUI(); opts = opts || {};
    const limit = opts.limit || 5, fmt = opts.format || ((v) => String(v));
    const title = opts.title || 'Classement en ligne';
    el.innerHTML = `<div class="gp-lbtitle">${title}</div><div class="gp-muted">chargement…</div>`;
    const data = opts.daily
      ? await getDailyLeaderboard({ gameId: opts.gameId, limit: 60 })
      : await getLeaderboard({ gameId: opts.gameId, limit: 60 });
    if (!data.length) {
      el.innerHTML = `<div class="gp-lbtitle">${title}</div><div class="gp-muted">${sb ? 'Sois le premier à inscrire ton score.' : 'Classement en ligne indisponible.'}</div>`;
      return;
    }
    const me = data.find((r) => r.is_me);
    let html = `<div class="gp-lbtitle">${title}</div>`;
    data.slice(0, limit).forEach((r) => {
      html += `<div class="gp-row ${r.is_me ? 'gp-me' : ''}"><span class="gp-rk">${r.rank}</span><span class="gp-name">${escapeHtml(r.username || '—')}</span><span class="gp-val">${fmt(r.value)}</span></div>`;
    });
    if (me && me.rank > limit) {
      html += `<div class="gp-row gp-me"><span class="gp-rk">${me.rank}</span><span class="gp-name">${escapeHtml(me.username || 'toi')}</span><span class="gp-val">${fmt(me.value)}</span></div>`;
    }
    el.innerHTML = html;
  }

  // Fin de partie standardisée : envoie le score (normal OU défi), met à jour la
  // ligne réseau (+ série), puis affiche le top. Remplace le copier-coller des 4 jeux.
  //   opts = { daily, gameId, netEl, lbEl, limit, title, format }
  async function finishRun(value, meta, opts){
    opts = opts || {};
    const isDaily = !!opts.daily;
    const r = isDaily ? await submitDaily(value, meta) : await submitScore(value, meta);
    if (opts.netEl){
      let txt = sb ? (isDaily ? 'défi du jour envoyé' : 'score envoyé au classement')
                   : (isDaily ? 'hors-ligne — score local' : 'hors-ligne — score gardé en local');
      if (isDaily){ const st = getStreak(); if (st && st.count > 0) txt += ' · série ' + st.count + ' j'; }
      opts.netEl.textContent = txt;
    }
    if (opts.lbEl && sb){
      const o = { gameId: opts.gameId || gameId, limit: opts.limit || 5, daily: isDaily,
                  title: opts.title || (isDaily ? 'Défi du jour' : 'Classement en ligne'), format: opts.format };
      setTimeout(() => renderTop(opts.lbEl, o), 350);
    }
    return r;
  }

  // ---------- Défi du jour ----------
  function dayStr(d){ d = d || new Date(); return d.toISOString().slice(0, 10); } // UTC YYYY-MM-DD
  function hashStr(s){ let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function mulberry32(a){ return function(){ a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  // Renvoie la graine et le générateur déterministes du jour (identiques pour tous).
  function daily(){ const date = dayStr(); const seed = hashStr('ember-arcade-' + date); return { date, seed, rng: mulberry32(seed) }; }

  async function submitDaily(value, meta){
    const date = dayStr();
    value = Math.max(0, Math.floor(value || 0));
    const k = 'gp:' + gameId + ':daily:' + date;
    const prev = +(localStorage.getItem(k) || 0); if (value > prev) localStorage.setItem(k, value);
    bumpStreak(date);
    if (!sb || !user) return { ok: true, online: false };
    try {
      const { error } = await sb.from('scores').insert({
        game_id: gameId, user_id: user.id, value, day: date,
        meta: Object.assign({ mode: 'daily' }, meta || {})
      });
      if (error) throw error;
      track('daily', Object.assign({ value: value }, meta || {}));
      return { ok: true, online: true };
    } catch (e) { console.warn('[GamePortal] défi non envoyé :', e.message); return { ok: false, error: e.message }; }
  }

  async function getDailyLeaderboard(o){
    o = o || {}; const gid = o.gameId || gameId; const date = o.date || dayStr(); const limit = o.limit || 60;
    if (!sb) { const v = +(localStorage.getItem('gp:' + gid + ':daily:' + date) || 0); return v ? [{ rank: 1, username: getUsername(), value: v, is_me: true }] : []; }
    try {
      const { data, error } = await sb.from('v_daily').select('*')
        .eq('game_id', gid).eq('day', date).order('rank', { ascending: true }).limit(limit);
      if (error) throw error;
      return (data || []).map((r) => ({ ...r, is_me: !!(user && r.user_id === user.id) }));
    } catch (e) { console.warn('[GamePortal] classement du jour indispo :', e.message); return []; }
  }

  // Série de jours consécutifs avec un défi joué.
  function getStreak(){
    try { return JSON.parse(localStorage.getItem('gp:streak')) || { count: 0, best: 0, last: null }; }
    catch (e) { return { count: 0, best: 0, last: null }; }
  }
  function bumpStreak(date){
    const s = getStreak();
    if (s.last === date) return s; // déjà compté aujourd'hui
    const yesterday = dayStr(new Date(Date.now() - 86400000));
    s.count = (s.last === yesterday) ? (s.count || 0) + 1 : 1;
    s.last = date; s.best = Math.max(s.best || 0, s.count);
    localStorage.setItem('gp:streak', JSON.stringify(s));
    if (sb && user) { try { sb.from('progress').upsert({ user_id: user.id, game_id: '_portal', key: 'streak', data: s }); } catch (e) {} }
    return s;
  }

  // ================= Ember Coins · Niveau global · Succès =================
  // Stockage local : même origine => partagé entre le portail et TOUS les jeux.
  const W = { coins:'gp:coins', xp:'gp:xp', ach:'gp:ach' };
  function _int(k){ return Math.max(0, Math.floor(+(localStorage.getItem(k)||0))); }
  function getCoins(){ return _int(W.coins); }
  function getXP(){ return _int(W.xp); }
  function _achMap(){ try { return JSON.parse(localStorage.getItem(W.ach)) || {}; } catch(e){ return {}; } }

  function emitWallet(){ try { window.dispatchEvent(new CustomEvent('gp:wallet', { detail:{ coins:getCoins(), xp:getXP(), level:getLevel() } })); } catch(e){} }

  let _syncT = 0;
  function syncWallet(){ // sauvegarde best-effort (table progress existante)
    if (!sb || !user) return;
    clearTimeout(_syncT);
    _syncT = setTimeout(() => {
      try { sb.from('progress').upsert({ user_id:user.id, game_id:'_portal', key:'wallet',
        data:{ coins:getCoins(), xp:getXP(), ach:_achMap() } }); } catch(e){}
    }, 800);
  }
  async function loadWallet(){ if(!sb||!user) return;
    try {
      const { data } = await sb.from('progress').select('data')
        .eq('user_id',user.id).eq('game_id','_portal').eq('key','wallet').maybeSingle();
      if (data && data.data){ const s=data.data; // adopte le meilleur (pas de perte entre appareils)
        if ((s.coins||0) > getCoins()) localStorage.setItem(W.coins, Math.floor(s.coins));
        if ((s.xp||0) > getXP()) localStorage.setItem(W.xp, Math.floor(s.xp));
        const m=_achMap(), sm=s.ach||{}; let ch=false;
        for (const k in sm){ if(!m[k]){ m[k]=sm[k]; ch=true; } }
        if (ch) localStorage.setItem(W.ach, JSON.stringify(m));
        emitWallet();
      }
    } catch(e){}
  }

  function setCoins(v){ localStorage.setItem(W.coins, Math.max(0, Math.floor(v||0))); emitWallet(); syncWallet(); }
  function addCoins(n, reason, opts){ n=Math.floor(n||0); if(n<=0) return getCoins();
    setCoins(getCoins()+n);
    if(!(opts&&opts.silent)) toast('+'+n+' Ember Coins', { kind:'coin', icon:'◉' });
    track('coins', { n:n, reason:reason||'' });
    return getCoins(); }
  function spendCoins(n){ n=Math.floor(n||0); if(getCoins()<n) return { ok:false, balance:getCoins() };
    setCoins(getCoins()-n); return { ok:true, balance:getCoins() }; }

  // Courbe de niveau : passer du niveau n à n+1 coûte 100 + 60*(n-1) XP.
  function levelFromXP(xp){ let lvl=1, need=100, acc=0;
    while (xp >= acc+need) { acc+=need; lvl++; need=100+(lvl-1)*60; }
    return { level:lvl, into:xp-acc, need:need, pct:Math.max(0,Math.min(1,(xp-acc)/need)), xp:xp }; }
  function getLevel(){ return levelFromXP(getXP()); }
  function addXP(n, reason){ n=Math.floor(n||0); if(n<=0) return getLevel();
    const before=getLevel().level;
    localStorage.setItem(W.xp, getXP()+n); emitWallet(); syncWallet();
    const after=getLevel().level;
    if (after>before) toast('Niveau '+after+' atteint', { kind:'level', icon:'★' });
    track('xp', { n:n, reason:reason||'' });
    return getLevel(); }

  // ---- Registre des succès (partagé portail + jeux) ----
  const ACHIEVEMENTS = [
    { id:'ef_first',  game:'emberfall', name:'Première étincelle', desc:'Terminer une partie d\'Emberfall',          coin:10 },
    { id:'ef_5min',   game:'emberfall', name:'Survivant',          desc:'Survivre 5 minutes',                        coin:30 },
    { id:'ef_10min',  game:'emberfall', name:'Increvable',         desc:'Survivre 10 minutes',                       coin:60 },
    { id:'ef_biome',  game:'emberfall', name:'Explorateur',        desc:'Atteindre un nouveau biome',                coin:25 },
    { id:'ef_kills',  game:'emberfall', name:'Moissonneur',        desc:'Vaincre 500 ennemis en une partie',         coin:35 },
    { id:'ef_hard',   game:'emberfall', name:'Bravoure',           desc:'Terminer une partie en Cauchemar ou plus',  coin:40 },
    { id:'lu_first',  game:'lumen',     name:'Premier éclat',      desc:'Terminer une partie de Lumen',              coin:10 },
    { id:'lu_combo',  game:'lumen',     name:'En cadence',         desc:'Atteindre le combo maximum (x9)',                    coin:25 },
    { id:'lu_score',  game:'lumen',     name:'Lumineux',           desc:'Marquer 1000 points',                       coin:30 },
    { id:'lu_daily',  game:'lumen',     name:'Rituel',             desc:'Jouer le défi du jour',                     coin:15 },
    { id:'aw_first',  game:'ageofwar',  name:'Première bataille',  desc:'Terminer une partie de Conquête',           coin:10 },
    { id:'aw_age5',   game:'ageofwar',  name:'À travers les âges', desc:'Atteindre l\'ère Futur',                     coin:40 },
    { id:'aw_win',    game:'ageofwar',  name:'Conquérant',         desc:'Détruire la base ennemie',                  coin:50 },
    { id:'aw_turret', game:'ageofwar',  name:'Forteresse',         desc:'Déployer 4 tourelles',                      coin:25 },
    { id:'eh_first',  game:'emberhill', name:'Premier run',        desc:'Terminer un run d\'Ember Hill',              coin:10 },
    { id:'eh_1km',    game:'emberhill', name:'Routier',            desc:'Parcourir 1000 m en un run',                coin:30 },
    { id:'eh_5km',    game:'emberhill', name:'Cascadeur',          desc:'Parcourir 5000 m en un run',                coin:60 },
    { id:'eh_flip',   game:'emberhill', name:'Salto',              desc:'Réussir un salto complet en l\'air',         coin:25 },
    { id:'eh_moon',   game:'emberhill', name:'Sur la Lune',        desc:'Débloquer le stage Lune',                   coin:20 },
    { id:'pb_first',  game:'prismbreak',name:'Premier prisme',     desc:'Terminer une partie de Prismbreak',         coin:10 },
    { id:'pb_lvl5',   game:'prismbreak',name:'Briseur',            desc:'Atteindre le niveau 5',                     coin:30 },
    { id:'pb_combo',  game:'prismbreak',name:'Enchaîneur',         desc:'Combo de 15 sans rattraper la balle',       coin:25 },
    { id:'pb_multi',  game:'prismbreak',name:'Pluie de balles',    desc:'Avoir 5 balles en jeu',                     coin:20 },
    { id:'pb_5k',     game:'prismbreak',name:'Score lumineux',     desc:'Marquer 5000 points',                       coin:35 }
  ];
  const ACH_BY_ID = {}; ACHIEVEMENTS.forEach(a => ACH_BY_ID[a.id]=a);
  function getAchievements(){ const m=_achMap(); return ACHIEVEMENTS.map(a => Object.assign({}, a, { unlocked: !!m[a.id], at: m[a.id]||null })); }
  function isUnlocked(id){ return !!_achMap()[id]; }
  function unlock(id){ const a=ACH_BY_ID[id]; if(!a) return { ok:false, error:'unknown' };
    const m=_achMap(); if (m[id]) return { ok:true, already:true };
    m[id]=new Date().toISOString(); localStorage.setItem(W.ach, JSON.stringify(m));
    addCoins(a.coin, 'ach:'+id, { silent:true });
    toast('Succès — '+a.name, { kind:'ach', icon:'🏆', sub:'+'+a.coin+' Ember Coins · '+a.desc });
    emitWallet(); syncWallet(); track('achievement', { id:id });
    return { ok:true, coin:a.coin }; }

  // ---- Toasts (injectés ; marchent dans les jeux ET le portail) ----
  let toastWrap=null;
  function ensureToast(){ injectUI(); if(toastWrap) return;
    toastWrap=document.createElement('div'); toastWrap.className='gp-toasts'; document.body.appendChild(toastWrap); }
  function toast(text, opts){ opts=opts||{}; ensureToast();
    const t=document.createElement('div'); t.className='gp-toast gp-toast-'+(opts.kind||'info');
    t.innerHTML='<div class="gp-toast-main">'+(opts.icon?'<span class="gp-toast-ic">'+opts.icon+'</span>':'')+escapeHtml(text)+'</div>'+
      (opts.sub?'<div class="gp-toast-sub">'+escapeHtml(opts.sub)+'</div>':'');
    toastWrap.appendChild(t);
    requestAnimationFrame(()=>t.classList.add('in'));
    setTimeout(()=>{ t.classList.remove('in'); setTimeout(()=>t.remove(), 420); }, opts.kind==='ach'?4200:2700); }

  const GamePortal = {
    init, ready,
    getUsername, setUsername,
    submitScore, getLeaderboard, getGames,
    saveProgress, loadProgress,
    promptUsername, renderTop, finishRun, esc: escapeHtml,
    daily, submitDaily, getDailyLeaderboard, getStreak,
    track,
    getCoins, addCoins, spendCoins, setCoins,
    getXP, addXP, getLevel,
    getAchievements, isUnlocked, unlock, toast,
    get user() { return user; },
    get profile() { return profile; },
    get online() { return !!sb; }
  };
  window.GamePortal = GamePortal;
})();

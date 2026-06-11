import { db, withTimeout, isTimeout } from './firebase.js';
import {
  doc, getDoc, setDoc, deleteDoc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ── Constantes ────────────────────────────────────────────────────────────────
const SESSION_KEY  = 'bio_admin_sess';
const SESSION_TTL  = 8 * 60 * 60 * 1000; // 8 horas
const FAIL_KEY     = 'bio_admin_fails';
const MAX_FAILS    = 5;
const LOCKOUT_MS   = 30 * 60 * 1000; // 30 min
const WRITE_TIMEOUT = 8000;
const READ_TIMEOUT  = 8000;

const ICONS = [
  { label: 'Site',       cls: 'fa-solid fa-globe' },
  { label: 'Link',       cls: 'fa-solid fa-link' },
  { label: 'E-mail',     cls: 'fa-solid fa-envelope' },
  { label: 'Telefone',   cls: 'fa-solid fa-phone' },
  { label: 'Portfólio',  cls: 'fa-solid fa-briefcase' },
  { label: 'Código',     cls: 'fa-solid fa-code' },
  { label: 'Estrela',    cls: 'fa-solid fa-star' },
  { label: 'LinkedIn',   cls: 'fa-brands fa-linkedin-in' },
  { label: 'WhatsApp',   cls: 'fa-brands fa-whatsapp' },
  { label: 'Instagram',  cls: 'fa-brands fa-instagram' },
  { label: 'GitHub',     cls: 'fa-brands fa-github' },
  { label: 'X/Twitter',  cls: 'fa-brands fa-x-twitter' },
  { label: 'YouTube',    cls: 'fa-brands fa-youtube' },
  { label: 'TikTok',     cls: 'fa-brands fa-tiktok' },
  { label: 'Telegram',   cls: 'fa-brands fa-telegram' },
  { label: 'Discord',    cls: 'fa-brands fa-discord' },
  { label: 'Behance',    cls: 'fa-brands fa-behance' },
  { label: 'Dribbble',   cls: 'fa-brands fa-dribbble' },
  { label: 'Figma',      cls: 'fa-brands fa-figma' },
  { label: 'Medium',     cls: 'fa-brands fa-medium' },
  { label: 'Pinterest',  cls: 'fa-brands fa-pinterest' },
  { label: 'Twitch',     cls: 'fa-brands fa-twitch' },
  { label: 'Spotify',    cls: 'fa-brands fa-spotify' },
];

// ── Estado global ─────────────────────────────────────────────────────────────
let bioConfig = null;
let authDoc = null;            // { hash, recoveryHash, v }
let modalMode = 'link';
let editingId = null;
let setupCtx = null;           // { hash, recovery } durante o setup
let resetCtx = null;           // { recoveryHash } durante o reset

// ── Helpers ───────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function genRecoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return hex.match(/.{1,4}/g).join('-'); // XXXX-XXXX-XXXX-XXXX-XXXX
}

const normalizeRecovery = c => (c || '').replace(/[^a-z0-9]/gi, '').toUpperCase();

// Executa uma ação assíncrona mostrando spinner no botão e bloqueando-o.
async function runWithSpinner(btn, fn, loadingText = '') {
  if (!btn) return fn();
  const original = btn.innerHTML;
  const w = btn.offsetWidth;
  btn.style.minWidth = w + 'px';
  btn.disabled = true;
  btn.classList.add('is-loading');
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>${loadingText ? ' ' + loadingText : ''}`;
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-loading');
    btn.innerHTML = original;
    btn.style.minWidth = '';
  }
}

// ── Rate limiting ─────────────────────────────────────────────────────────────
function getFails() {
  const d = JSON.parse(localStorage.getItem(FAIL_KEY) || '{"n":0,"t":0}');
  if (Date.now() - d.t > LOCKOUT_MS) return { n: 0, t: 0 };
  return d;
}
function addFail() {
  const d = getFails();
  d.n++; if (d.t === 0) d.t = Date.now();
  localStorage.setItem(FAIL_KEY, JSON.stringify(d));
  return d.n;
}
function clearFails() { localStorage.removeItem(FAIL_KEY); }
function isLocked() { const d = getFails(); return d.n >= MAX_FAILS; }

// ── Session ───────────────────────────────────────────────────────────────────
function saveSession() {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ at: Date.now(), exp: Date.now() + SESSION_TTL }));
}
function hasSession() {
  const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
  return s && Date.now() < s.exp;
}
function clearSession() { sessionStorage.removeItem(SESSION_KEY); }

// ── Toast ─────────────────────────────────────────────────────────────────────
let _toastTimer;
function toast(msg, type = 'success') {
  const el = $('toast');
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="fa-solid fa-${type === 'success' ? 'check' : type === 'error' ? 'triangle-exclamation' : 'circle-info'}"></i> ${msg}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
}

// ── Firestore (com timeout) ─────────────────────────────────────────────────────
async function loadAuth() {
  const snap = await withTimeout(getDoc(doc(db, 'admin', 'auth')), READ_TIMEOUT, 'loadAuth');
  return snap.exists() ? snap.data() : null;
}
async function saveAuth(data) {
  await withTimeout(setDoc(doc(db, 'admin', 'auth'), data), WRITE_TIMEOUT, 'saveAuth');
}
async function loadConfig() {
  const snap = await withTimeout(getDoc(doc(db, 'bio', 'config')), READ_TIMEOUT, 'loadConfig');
  return snap.exists() ? snap.data() : null;
}
async function saveConfig(cfg) {
  await withTimeout(setDoc(doc(db, 'bio', 'config'), cfg), WRITE_TIMEOUT, 'saveConfig');
}

// ── Screens / panels ────────────────────────────────────────────────────────────
function showScreen(id) {
  ['screen-auth', 'screen-dashboard'].forEach(s => {
    $(s).classList.toggle('hidden', s !== id);
  });
}

function showAuthPanel(id) {
  document.querySelectorAll('.auth-panel').forEach(p => {
    const on = p.id === id;
    p.classList.toggle('hidden', !on);
    if (on) { p.classList.remove('panel-anim'); void p.offsetWidth; p.classList.add('panel-anim'); }
  });
}

// ── Boot da autenticação ────────────────────────────────────────────────────────
async function initAuth() {
  bindRevealButtons();
  bindAuthHandlers();

  if (hasSession()) {
    try { await enterDashboard(); return; }
    catch { clearSession(); }
  }

  showScreen('screen-auth');

  try {
    authDoc = await loadAuth();
  } catch (e) {
    console.error('[Admin] Erro ao carregar auth:', e);
    $('login-error').textContent = isTimeout(e)
      ? '⚠️ Conexão lenta/bloqueada. Verifique sua rede e tente novamente.'
      : '⚠️ Erro de conexão com o Firestore. Verifique as regras do banco.';
    showAuthPanel('panel-login');
    return;
  }

  if (!authDoc) {
    showAuthPanel('panel-setup');
  } else {
    showAuthPanel('panel-login');
  }
}

// ── Reveal de senha ──────────────────────────────────────────────────────────────
function bindRevealButtons() {
  document.addEventListener('click', e => {
    const btn = e.target.closest('.reveal-btn');
    if (!btn) return;
    const input = $(btn.dataset.target);
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.querySelector('i').className = show ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
  });
}

// ── Handlers de auth (ligados uma única vez) ────────────────────────────────────
function bindAuthHandlers() {
  // SETUP ─ definir senha e gerar código de recuperação
  $('form-setup-el').addEventListener('submit', async e => {
    e.preventDefault();
    const p = $('setup-pass').value;
    const c = $('setup-confirm').value;
    $('setup-error').textContent = '';
    if (p.length < 6) { $('setup-error').textContent = 'Senha deve ter ao menos 6 caracteres.'; return; }
    if (p !== c)      { $('setup-error').textContent = 'As senhas não coincidem.'; return; }

    await runWithSpinner($('btn-setup'), async () => {
      const recovery = genRecoveryCode();
      setupCtx = {
        hash: await sha256(p),
        recoveryHash: await sha256(normalizeRecovery(recovery)),
      };
      $('recovery-code').textContent = recovery;
      $('recovery-ack').checked = false;
      $('btn-recovery-continue').disabled = true;
      $('btn-recovery-continue').dataset.flow = 'setup';
      showAuthPanel('panel-recovery');
    }, 'Gerando...');
  });

  // RECOVERY ─ confirmar que guardou o código e prosseguir
  $('recovery-ack').addEventListener('change', () => {
    $('btn-recovery-continue').disabled = !$('recovery-ack').checked;
  });
  $('btn-copy-recovery').addEventListener('click', () => copyText($('recovery-code').textContent, $('btn-copy-recovery')));
  $('btn-recovery-continue').addEventListener('click', async () => {
    if (!setupCtx) return;
    await runWithSpinner($('btn-recovery-continue'), async () => {
      try {
        await saveAuth({ hash: setupCtx.hash, recoveryHash: setupCtx.recoveryHash, v: 2 });
      } catch (err) {
        if (!isTimeout(err)) {
          toast('Erro ao salvar. Verifique as regras do Firestore.', 'error');
          throw err;
        }
        // timeout: gravação ficou no cache local e sincroniza depois — prossegue
        toast('Salvo localmente — sincronizando...', 'info');
      }
      authDoc = { hash: setupCtx.hash, recoveryHash: setupCtx.recoveryHash, v: 2 };
      setupCtx = null;
      saveSession();
      await enterDashboard();
    }, 'Salvando...');
  });

  // LOGIN
  $('form-login-el').addEventListener('submit', async e => {
    e.preventDefault();
    if (isLocked()) { $('login-error').textContent = 'Muitas tentativas. Aguarde 30 minutos.'; return; }
    const p = $('login-pass').value;
    if (!p) { $('login-error').textContent = 'Informe a senha.'; return; }
    $('login-error').textContent = '';

    await runWithSpinner($('btn-login'), async () => {
      let auth;
      try { auth = authDoc || await loadAuth(); }
      catch (err) {
        $('login-error').textContent = isTimeout(err)
          ? '⚠️ Conexão lenta/bloqueada. Tente novamente.'
          : '⚠️ Erro de conexão. Verifique as regras do Firestore.';
        return;
      }
      if (!auth) { $('login-error').textContent = 'Nenhuma senha cadastrada. Recarregue a página.'; return; }
      authDoc = auth;

      if (auth.hash === await sha256(p)) {
        clearFails();
        saveSession();
        await enterDashboard();
        return;
      }
      const n = addFail();
      const left = MAX_FAILS - n;
      $('login-error').textContent = left > 0
        ? `Senha incorreta. ${left} tentativa(s) restante(s).`
        : 'Conta bloqueada por 30 minutos.';
      $('login-pass').value = '';
    }, 'Verificando...');
  });

  // Ir para o fluxo de reset
  $('btn-reset').addEventListener('click', () => {
    $('reset-code').value = '';
    $('reset-error').textContent = '';
    showAuthPanel('panel-reset');
    $('reset-code').focus();
  });
  $('btn-reset-back').addEventListener('click', () => showAuthPanel('panel-login'));

  // RESET passo 1 ─ verificar código de recuperação
  $('form-reset-el').addEventListener('submit', async e => {
    e.preventDefault();
    if (isLocked()) { $('reset-error').textContent = 'Muitas tentativas. Aguarde 30 minutos.'; return; }
    const code = $('reset-code').value.trim();
    $('reset-error').textContent = '';
    if (!code) { $('reset-error').textContent = 'Informe o código de recuperação.'; return; }

    await runWithSpinner($('btn-reset-verify'), async () => {
      let auth;
      try { auth = authDoc || await loadAuth(); }
      catch (err) {
        $('reset-error').textContent = isTimeout(err) ? '⚠️ Conexão lenta/bloqueada. Tente novamente.' : '⚠️ Erro de conexão.';
        return;
      }
      if (!auth) { $('reset-error').textContent = 'Nenhuma senha cadastrada.'; return; }
      authDoc = auth;

      if (!auth.recoveryHash) {
        $('reset-error').textContent = 'Esta conta não tem código de recuperação. Faça login e gere um em Segurança.';
        return;
      }
      if (await sha256(normalizeRecovery(code)) === auth.recoveryHash) {
        clearFails();
        resetCtx = { recoveryHash: auth.recoveryHash };
        $('reset-new-pass').value = '';
        $('reset-new-confirm').value = '';
        $('reset-new-error').textContent = '';
        showAuthPanel('panel-reset-new');
        $('reset-new-pass').focus();
      } else {
        const n = addFail();
        const left = MAX_FAILS - n;
        $('reset-error').textContent = left > 0
          ? `Código incorreto. ${left} tentativa(s) restante(s).`
          : 'Bloqueado por 30 minutos.';
      }
    }, 'Verificando...');
  });

  // RESET passo 2 ─ salvar nova senha
  $('form-reset-new-el').addEventListener('submit', async e => {
    e.preventDefault();
    const p = $('reset-new-pass').value;
    const c = $('reset-new-confirm').value;
    $('reset-new-error').textContent = '';
    if (p.length < 6) { $('reset-new-error').textContent = 'Senha deve ter ao menos 6 caracteres.'; return; }
    if (p !== c)      { $('reset-new-error').textContent = 'As senhas não coincidem.'; return; }
    if (!resetCtx)    { showAuthPanel('panel-login'); return; }

    await runWithSpinner($('btn-reset-save'), async () => {
      const newDoc = { hash: await sha256(p), recoveryHash: resetCtx.recoveryHash, v: 2 };
      try {
        await saveAuth(newDoc);
      } catch (err) {
        if (!isTimeout(err)) { toast('Erro ao salvar nova senha.', 'error'); throw err; }
        toast('Salvo localmente — sincronizando...', 'info');
      }
      authDoc = newDoc;
      resetCtx = null;
      clearFails();
      saveSession();
      await enterDashboard();
    }, 'Salvando...');
  });
}

function copyText(text, btn) {
  navigator.clipboard?.writeText(text).then(() => {
    if (btn) {
      const i = btn.querySelector('i');
      const prev = i.className;
      i.className = 'fa-solid fa-check';
      setTimeout(() => { i.className = prev; }, 1400);
    }
    toast('Código copiado!', 'success');
  }).catch(() => toast('Não foi possível copiar.', 'error'));
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  name: 'Murylo Neves',
  role: 'Dev Web',
  description: 'Construindo interfaces limpas, rápidas e escaláveis. Especialista em transformar design em código de alta performance.',
  photo: 'murylo.jpg',
  statusText: 'Disponível para projetos',
  statusActive: true,
  tags: ['Criação de Sites', 'Landing Pages', 'Sistemas Web'],
  links: [
    { id: '1', title: 'Meu Site & Portfólio', subtitle: 'Portfólio e serviços', url: 'https://site-murylo-dev.netlify.app/', icon: 'fa-solid fa-globe', active: true, order: 0 },
    { id: '2', title: 'LinkedIn', subtitle: 'Conexões profissionais', url: 'https://www.linkedin.com/in/murylo-neves-77053a269', icon: 'fa-brands fa-linkedin-in', active: true, order: 1 },
    { id: '3', title: 'Fale comigo', subtitle: 'Orçamentos via WhatsApp', url: 'https://wa.me/5592992866146?text=Olá,%20Murylo!', icon: 'fa-brands fa-whatsapp', active: true, order: 2 }
  ],
  social: [
    { id: '1', platform: 'Instagram', handle: '@murylo.dev', url: 'https://instagram.com/murylo.dev', icon: 'fa-brands fa-instagram', active: true }
  ]
};

let dashboardBound = false;

async function enterDashboard() {
  showScreen('screen-dashboard');
  try {
    const cfg = await loadConfig();
    bioConfig = cfg || DEFAULT_CONFIG;
  } catch (e) {
    console.error('[Admin] Erro ao carregar config:', e);
    toast(isTimeout(e) ? 'Conexão lenta — usando dados padrão.' : 'Erro ao carregar dados do Firestore.', 'error');
    bioConfig = DEFAULT_CONFIG;
  }
  populateForms();
  renderLinks();
  renderTags();
  renderSocial();
  buildIconPicker();
  if (!dashboardBound) { bindDashboard(); dashboardBound = true; }
  if (window.innerWidth >= 1100) setPreview(true);
  updatePreview();
}

function populateForms() {
  $('field-name').value        = bioConfig.name;
  $('field-role').value        = bioConfig.role;
  $('field-description').value = bioConfig.description;
  $('field-photo').value       = bioConfig.photo;
  $('field-status-text').value = bioConfig.statusText;
  $('field-status-active').checked = bioConfig.statusActive;
}

// ── Navegação de seções ─────────────────────────────────────────────────────────
function bindDashboard() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('active')) return;
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      const sec = $(`section-${btn.dataset.section}`);
      sec.classList.add('active');
      document.querySelector('.admin-main')?.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  $('btn-logout').addEventListener('click', () => { clearSession(); location.reload(); });

  // Preview
  $('btn-toggle-preview').addEventListener('click', togglePreview);
  $('btn-close-preview').addEventListener('click', () => setPreview(false));
  $('btn-reload-preview').addEventListener('click', () => {
    const f = $('preview-frame');
    if (f) { previewReady = false; f.src = f.src; }
  });
  const pf = $('preview-frame');
  pf.addEventListener('load', () => { previewReady = true; updatePreview(); });
  // O iframe pode já ter carregado antes deste listener (carrega mesmo oculto)
  try {
    if (pf.contentDocument && pf.contentDocument.readyState === 'complete') {
      previewReady = true;
    }
  } catch { /* mesma origem; ignora */ }

  // Live sync perfil + status -> preview
  ['field-name', 'field-role', 'field-description', 'field-photo', 'field-status-text'].forEach(id => {
    $(id).addEventListener('input', liveSync);
  });
  $('field-status-active').addEventListener('change', liveSync);

  // Perfil
  $('btn-save-perfil').addEventListener('click', () => runWithSpinner($('btn-save-perfil'), async () => {
    bioConfig.name        = $('field-name').value.trim();
    bioConfig.role        = $('field-role').value.trim();
    bioConfig.description = $('field-description').value.trim();
    bioConfig.photo       = $('field-photo').value.trim();
    await persist('Perfil salvo!');
  }, 'Salvando...'));

  // Status
  $('btn-save-status').addEventListener('click', () => runWithSpinner($('btn-save-status'), async () => {
    bioConfig.statusText   = $('field-status-text').value.trim();
    bioConfig.statusActive = $('field-status-active').checked;
    await persist('Status salvo!');
  }, 'Salvando...'));

  // Links / Tags / Social
  $('btn-add-link').addEventListener('click', () => openModal('link', null));
  $('btn-add-tag').addEventListener('click', () => runWithSpinner($('btn-add-tag'), addTag));
  $('new-tag-input').addEventListener('keydown', e => { if (e.key === 'Enter') runWithSpinner($('btn-add-tag'), addTag); });
  $('btn-add-social').addEventListener('click', () => openModal('social', null));

  // Modal
  $('modal-close').addEventListener('click', closeModal);
  $('modal-cancel').addEventListener('click', closeModal);
  $('modal-overlay').addEventListener('click', e => { if (e.target === $('modal-overlay')) closeModal(); });
  $('modal-save').addEventListener('click', () => runWithSpinner($('modal-save'), saveModal, 'Salvando...'));
  $('modal-field-icon').addEventListener('input', () => syncIconPicker($('modal-field-icon').value.trim()));

  bindSecurity();
}

// ── Segurança ─────────────────────────────────────────────────────────────────
function bindSecurity() {
  $('btn-change-pass').addEventListener('click', () => runWithSpinner($('btn-change-pass'), async () => {
    const cur = $('sec-current').value;
    const nw  = $('sec-new').value;
    const cf  = $('sec-confirm').value;
    if (!authDoc) { toast('Sessão inválida. Recarregue a página.', 'error'); return; }
    if (await sha256(cur) !== authDoc.hash) { toast('Senha atual incorreta.', 'error'); return; }
    if (nw.length < 6) { toast('Nova senha deve ter ao menos 6 caracteres.', 'error'); return; }
    if (nw !== cf)     { toast('As senhas não coincidem.', 'error'); return; }

    const newDoc = { ...authDoc, hash: await sha256(nw), v: 2 };
    try { await saveAuth(newDoc); }
    catch (err) { if (!isTimeout(err)) { toast('Erro ao salvar.', 'error'); return; } toast('Salvo localmente — sincronizando...', 'info'); }
    authDoc = newDoc;
    $('sec-current').value = $('sec-new').value = $('sec-confirm').value = '';
    toast('Senha atualizada!', 'success');
  }, 'Salvando...'));

  $('btn-regen-recovery').addEventListener('click', () => runWithSpinner($('btn-regen-recovery'), async () => {
    const pass = $('sec-recov-pass').value;
    if (!authDoc) { toast('Sessão inválida. Recarregue a página.', 'error'); return; }
    if (await sha256(pass) !== authDoc.hash) { toast('Senha atual incorreta.', 'error'); return; }

    const recovery = genRecoveryCode();
    const newDoc = { ...authDoc, recoveryHash: await sha256(normalizeRecovery(recovery)), v: 2 };
    try { await saveAuth(newDoc); }
    catch (err) { if (!isTimeout(err)) { toast('Erro ao salvar.', 'error'); return; } toast('Salvo localmente — sincronizando...', 'info'); }
    authDoc = newDoc;
    $('sec-recov-pass').value = '';
    $('sec-recovery-code').textContent = recovery;
    $('sec-recovery-display').classList.remove('hidden');
    toast('Novo código gerado! Guarde-o.', 'success');
  }, 'Gerando...'));

  $('btn-copy-sec-recovery').addEventListener('click', () =>
    copyText($('sec-recovery-code').textContent, $('btn-copy-sec-recovery')));
}

// ── Persist ───────────────────────────────────────────────────────────────────
async function persist(msg = 'Salvo!') {
  updatePreview();
  try {
    await saveConfig(bioConfig);
    toast(msg, 'success');
  } catch (e) {
    if (isTimeout(e)) toast('Salvo localmente — sincronizando com o servidor...', 'info');
    else toast('Erro ao salvar. Verifique a conexão.', 'error');
  }
}

// ── Preview ao vivo ──────────────────────────────────────────────────────────────
let previewReady = false;
let _previewTimer;
function updatePreview() {
  if (!bioConfig) return;
  clearTimeout(_previewTimer);
  _previewTimer = setTimeout(() => {
    const f = $('preview-frame');
    if (!f || !previewReady || !f.contentWindow) return;
    try {
      f.contentWindow.postMessage({ type: 'bio-preview', config: JSON.parse(JSON.stringify(bioConfig)) }, '*');
    } catch { /* ignore */ }
  }, 60);
}

function liveSync() {
  if (!bioConfig) return;
  bioConfig.name        = $('field-name').value;
  bioConfig.role        = $('field-role').value;
  bioConfig.description = $('field-description').value;
  bioConfig.photo       = $('field-photo').value;
  bioConfig.statusText  = $('field-status-text').value;
  bioConfig.statusActive = $('field-status-active').checked;
  updatePreview();
}

function setPreview(on) {
  $('screen-dashboard').classList.toggle('preview-open', on);
  const btn = $('btn-toggle-preview');
  btn.classList.toggle('active', on);
  if (on) updatePreview();
}
function togglePreview() {
  setPreview(!$('screen-dashboard').classList.contains('preview-open'));
}

// ── Links ─────────────────────────────────────────────────────────────────────
function renderLinks() {
  const list = $('links-list');
  const sorted = [...bioConfig.links].sort((a, b) => a.order - b.order);
  list.innerHTML = sorted.map(link => `
    <div class="list-item" draggable="true" data-id="${link.id}">
      <span class="drag-handle"><i class="fa-solid fa-grip-vertical"></i></span>
      <div class="list-item-icon"><i class="${link.icon}"></i></div>
      <div class="list-item-info">
        <strong>${link.title}</strong>
        <span>${link.subtitle}</span>
      </div>
      <div class="list-item-actions">
        <label class="toggle" title="Ativar/desativar">
          <input type="checkbox" class="link-toggle" data-id="${link.id}" ${link.active ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
        <button class="btn-icon btn-icon-edit link-edit" data-id="${link.id}" title="Editar">
          <i class="fa-solid fa-pen"></i>
        </button>
        <button class="btn-icon btn-icon-delete link-delete" data-id="${link.id}" title="Remover">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    </div>`
  ).join('');

  list.querySelectorAll('.link-toggle').forEach(cb => {
    cb.addEventListener('change', async () => {
      const link = bioConfig.links.find(l => l.id === cb.dataset.id);
      if (link) { link.active = cb.checked; await persist(); }
    });
  });

  list.querySelectorAll('.link-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const link = bioConfig.links.find(l => l.id === btn.dataset.id);
      if (link) openModal('link', link);
    });
  });

  list.querySelectorAll('.link-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Remover este link?')) return;
      runWithSpinner(btn, async () => {
        bioConfig.links = bioConfig.links.filter(l => l.id !== btn.dataset.id);
        renderLinks();
        await persist('Link removido.');
      });
    });
  });

  bindDrag(list, 'links');
}

// ── Tags ──────────────────────────────────────────────────────────────────────
function renderTags() {
  const container = $('tags-list');
  container.innerHTML = bioConfig.tags.map((tag, i) => `
    <span class="tag-chip">
      ${tag}
      <button data-i="${i}" title="Remover"><i class="fa-solid fa-xmark"></i></button>
    </span>`
  ).join('');

  container.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', async () => {
      bioConfig.tags.splice(Number(btn.dataset.i), 1);
      renderTags();
      await persist('Tag removida.');
    });
  });
}

async function addTag() {
  const input = $('new-tag-input');
  const val = input.value.trim();
  if (!val) return;
  bioConfig.tags.push(val);
  input.value = '';
  renderTags();
  await persist('Tag adicionada.');
}

// ── Social ────────────────────────────────────────────────────────────────────
function renderSocial() {
  const list = $('social-list');
  list.innerHTML = bioConfig.social.map(s => `
    <div class="list-item" data-id="${s.id}">
      <div class="list-item-icon"><i class="${s.icon}"></i></div>
      <div class="list-item-info">
        <strong>${s.platform}</strong>
        <span>${s.handle}</span>
      </div>
      <div class="list-item-actions">
        <label class="toggle" title="Ativar/desativar">
          <input type="checkbox" class="social-toggle" data-id="${s.id}" ${s.active ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
        <button class="btn-icon btn-icon-edit social-edit" data-id="${s.id}" title="Editar">
          <i class="fa-solid fa-pen"></i>
        </button>
        <button class="btn-icon btn-icon-delete social-delete" data-id="${s.id}" title="Remover">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    </div>`
  ).join('');

  list.querySelectorAll('.social-toggle').forEach(cb => {
    cb.addEventListener('change', async () => {
      const s = bioConfig.social.find(x => x.id === cb.dataset.id);
      if (s) { s.active = cb.checked; await persist(); }
    });
  });

  list.querySelectorAll('.social-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = bioConfig.social.find(x => x.id === btn.dataset.id);
      if (s) openModal('social', s);
    });
  });

  list.querySelectorAll('.social-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Remover esta rede social?')) return;
      runWithSpinner(btn, async () => {
        bioConfig.social = bioConfig.social.filter(x => x.id !== btn.dataset.id);
        renderSocial();
        await persist('Rede social removida.');
      });
    });
  });
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openModal(mode, data) {
  modalMode = mode;
  editingId = data?.id || null;

  $('modal-title').textContent    = data ? `Editar ${mode === 'link' ? 'Link' : 'Rede Social'}` : `Adicionar ${mode === 'link' ? 'Link' : 'Rede Social'}`;
  $('modal-field-title').value    = data?.title    || data?.platform || '';
  $('modal-field-subtitle').value = data?.subtitle || '';
  $('modal-field-handle').value   = data?.handle   || '';
  $('modal-field-url').value      = data?.url      || '';
  $('modal-field-icon').value     = data?.icon     || '';
  $('modal-field-active').checked = data?.active !== false;

  $('modal-group-subtitle').style.display = mode === 'link'   ? '' : 'none';
  $('modal-group-handle').style.display   = mode === 'social' ? '' : 'none';

  syncIconPicker(data?.icon || '');
  const ov = $('modal-overlay');
  ov.classList.remove('hidden');
  ov.classList.remove('modal-anim'); void ov.offsetWidth; ov.classList.add('modal-anim');
  $('modal-field-title').focus();
}

function closeModal() { $('modal-overlay').classList.add('hidden'); }

async function saveModal() {
  const title  = $('modal-field-title').value.trim();
  const url    = $('modal-field-url').value.trim();
  const icon   = $('modal-field-icon').value.trim() || 'fa-solid fa-link';

  if (!title || !url) { toast('Título e URL são obrigatórios.', 'error'); return; }

  if (modalMode === 'link') {
    const subtitle = $('modal-field-subtitle').value.trim();
    const active   = $('modal-field-active').checked;
    if (editingId) {
      const link = bioConfig.links.find(l => l.id === editingId);
      if (link) Object.assign(link, { title, subtitle, url, icon, active });
    } else {
      const maxOrder = bioConfig.links.reduce((m, l) => Math.max(m, l.order), -1);
      bioConfig.links.push({ id: uid(), title, subtitle, url, icon, active, order: maxOrder + 1 });
    }
    renderLinks();
  } else {
    const platform = title;
    const handle   = $('modal-field-handle').value.trim();
    const active   = $('modal-field-active').checked;
    if (editingId) {
      const s = bioConfig.social.find(x => x.id === editingId);
      if (s) Object.assign(s, { platform, handle, url, icon, active });
    } else {
      bioConfig.social.push({ id: uid(), platform, handle, url, icon, active });
    }
    renderSocial();
  }

  closeModal();
  await persist('Salvo com sucesso!');
}

// ── Icon picker ───────────────────────────────────────────────────────────────
function buildIconPicker() {
  const picker = $('icon-picker');
  picker.innerHTML = ICONS.map(ic => `
    <button type="button" class="icon-opt" data-cls="${ic.cls}" title="${ic.label}">
      <i class="${ic.cls}"></i>
    </button>`
  ).join('');

  picker.querySelectorAll('.icon-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      $('modal-field-icon').value = btn.dataset.cls;
      syncIconPicker(btn.dataset.cls);
    });
  });
}

function syncIconPicker(cls) {
  document.querySelectorAll('.icon-opt').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.cls === cls);
  });
}

// ── Drag to reorder (links only) ──────────────────────────────────────────────
function bindDrag(list, type) {
  let dragId = null;

  list.querySelectorAll('.list-item').forEach(item => {
    item.addEventListener('dragstart', () => {
      dragId = item.dataset.id;
      setTimeout(() => item.classList.add('dragging'), 0);
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      list.querySelectorAll('.list-item').forEach(i => i.classList.remove('drag-over'));
    });

    item.addEventListener('dragover', e => {
      e.preventDefault();
      list.querySelectorAll('.list-item').forEach(i => i.classList.remove('drag-over'));
      if (item.dataset.id !== dragId) item.classList.add('drag-over');
    });

    item.addEventListener('drop', async e => {
      e.preventDefault();
      const targetId = item.dataset.id;
      if (!dragId || dragId === targetId) return;

      const arr = bioConfig[type];
      const from = arr.findIndex(x => x.id === dragId);
      const to   = arr.findIndex(x => x.id === targetId);
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      arr.forEach((x, i) => { if ('order' in x) x.order = i; });

      if (type === 'links') renderLinks();
      await persist('Ordem atualizada.');
    });
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────────
initAuth();

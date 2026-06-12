import { db, auth, withTimeout, isTimeout } from './firebase.js';
import {
  doc, getDoc, setDoc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
  EmailAuthProvider, reauthenticateWithCredential, updatePassword
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

// ── Constantes ────────────────────────────────────────────────────────────────
const WRITE_TIMEOUT = 8000;
const READ_TIMEOUT  = 8000;
const AUTH_TIMEOUT  = 12000;
const SESSION_TTL   = 30 * 60 * 1000; // 30 min de inatividade encerra a sessão
const LAST_ACTIVITY_KEY = 'admin:lastActivity';

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
let currentUser = null;
let inDashboard = false;
let modalMode = 'link';
let editingId = null;
let photoData = null; // imagem enviada (data URL); a URL digitada tem prioridade

// ── Helpers ───────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

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

// Traduz códigos de erro do Firebase Auth para mensagens amigáveis.
function authErrorMsg(e) {
  const c = String(e?.code || '');
  if (isTimeout(e) || c.includes('network')) return 'Falha de conexão. Verifique sua rede e tente novamente.';
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found'))
    return 'E-mail ou senha incorretos.';
  if (c.includes('invalid-email'))     return 'E-mail inválido.';
  if (c.includes('too-many-requests')) return 'Muitas tentativas. Tente novamente mais tarde.';
  if (c.includes('user-disabled'))     return 'Esta conta foi desativada.';
  if (c.includes('operation-not-allowed')) return 'Login por e-mail/senha não está habilitado no Firebase Console.';
  if (c.includes('configuration-not-found')) return 'Authentication não configurado no Firebase Console.';
  if (c.includes('unauthorized-domain')) return 'Domínio não autorizado. Adicione-o em Authentication → Settings → Authorized domains.';
  if (c.includes('requires-recent-login')) return 'Por segurança, saia e entre novamente antes de alterar a senha.';
  return 'Não foi possível concluir. Tente novamente.';
}

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

// ── Sessão por inatividade ──────────────────────────────────────────────────────
// O Firebase mantém a sessão para sempre (persistência local). Aqui gravamos a
// última atividade do usuário e, ao recarregar a página, derrubamos a sessão se
// ficou mais de SESSION_TTL parada — forçando novo login.
function sessionExpired() {
  const t = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
  return t > 0 && Date.now() - t > SESSION_TTL;
}

function touchSession() {
  localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
}

function trackActivity() {
  let last = 0;
  const handler = () => {
    if (!currentUser) return;
    const now = Date.now();
    if (now - last < 30000) return; // grava no máximo a cada 30s
    last = now;
    touchSession();
  };
  ['click', 'keydown', 'pointerdown', 'scroll'].forEach(ev =>
    document.addEventListener(ev, handler, { passive: true }));

  // Expira também com a aba aberta: checa a cada minuto se passou do TTL.
  setInterval(async () => {
    if (!currentUser || !sessionExpired()) return;
    localStorage.removeItem(LAST_ACTIVITY_KEY);
    try { await signOut(auth); } catch { /* listener trata */ }
    toast('Sessão expirada por inatividade. Entre novamente.', 'info');
  }, 60000);
}

// ── Boot da autenticação ────────────────────────────────────────────────────────
function initAuth() {
  bindRevealButtons();
  bindAuthHandlers();
  trackActivity();

  // O Firebase restaura a sessão automaticamente (persistência local).
  onAuthStateChanged(auth, async user => {
    if (user && sessionExpired()) {
      localStorage.removeItem(LAST_ACTIVITY_KEY);
      try { await signOut(auth); } catch { /* listener dispara de novo com user=null */ }
      toast('Sessão expirada por inatividade. Entre novamente.', 'info');
      return;
    }
    currentUser = user || null;
    if (user) {
      touchSession();
      if (!inDashboard) {
        inDashboard = true;
        try { await enterDashboard(); }
        catch (e) { console.error('[Admin] Erro ao abrir dashboard:', e); }
      }
      updateAccountInfo();
    } else {
      // Sem o registro de atividade, um login futuro não seria expirado por engano.
      localStorage.removeItem(LAST_ACTIVITY_KEY);
      inDashboard = false;
      showScreen('screen-auth');
      showAuthPanel('panel-login');
    }
  });
}

function updateAccountInfo() {
  if (currentUser && $('account-email')) $('account-email').textContent = currentUser.email || '—';
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
  // LOGIN
  $('form-login-el').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('login-email').value.trim();
    const pass  = $('login-pass').value;
    $('login-error').textContent = '';
    if (!email || !pass) { $('login-error').textContent = 'Informe e-mail e senha.'; return; }

    await runWithSpinner($('btn-login'), async () => {
      try {
        await withTimeout(signInWithEmailAndPassword(auth, email, pass), AUTH_TIMEOUT, 'login');
        // onAuthStateChanged cuida de abrir o dashboard.
      } catch (err) {
        console.error('[Admin] Erro no login:', err);
        $('login-error').textContent = authErrorMsg(err);
      }
    }, 'Entrando...');
  });

  // Ir para "esqueci a senha"
  $('btn-forgot').addEventListener('click', () => {
    $('forgot-email').value = $('login-email').value.trim();
    $('forgot-error').textContent = '';
    showAuthPanel('panel-forgot');
    $('forgot-email').focus();
  });
  $('btn-forgot-back').addEventListener('click', () => showAuthPanel('panel-login'));

  // Enviar e-mail de redefinição
  $('form-forgot-el').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('forgot-email').value.trim();
    $('forgot-error').textContent = '';
    if (!email) { $('forgot-error').textContent = 'Informe o e-mail da conta.'; return; }

    await runWithSpinner($('btn-forgot-send'), async () => {
      try {
        await withTimeout(sendPasswordResetEmail(auth, email), AUTH_TIMEOUT, 'reset');
      } catch (err) {
        // Não revela se o e-mail existe (evita enumeração), exceto erros técnicos.
        if (isTimeout(err) || String(err?.code).includes('network')) {
          $('forgot-error').textContent = 'Falha de conexão. Tente novamente.'; return;
        }
        if (String(err?.code).includes('invalid-email')) {
          $('forgot-error').textContent = 'E-mail inválido.'; return;
        }
      }
      toast('Se o e-mail existir, enviamos o link de redefinição.', 'success');
      showAuthPanel('panel-login');
    }, 'Enviando...');
  });
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
  updateAccountInfo();
  if (window.innerWidth >= 1100) setPreview(true);
  updatePreview();
}

function populateForms() {
  $('field-name').value        = bioConfig.name;
  $('field-role').value        = bioConfig.role;
  $('field-description').value = bioConfig.description;
  $('field-status-text').value = bioConfig.statusText;
  $('field-status-active').checked = bioConfig.statusActive;

  // Foto em base64 fica fora do input de URL (seria um texto gigante).
  const photo = bioConfig.photo || '';
  if (photo.startsWith('data:image/')) {
    photoData = photo;
    $('field-photo').value = '';
  } else {
    photoData = null;
    $('field-photo').value = photo;
  }
  updatePhotoThumb();
}

// ── Foto (upload + compressão) ──────────────────────────────────────────────────
function getPhotoValue() {
  return $('field-photo').value.trim() || photoData || '';
}

function updatePhotoThumb() {
  const v = getPhotoValue();
  if (v) $('photo-thumb').src = v;
}

// Redimensiona para no máx. 512px e converte para JPEG — um avatar vira ~50KB,
// pequeno o bastante para morar no doc do Firestore (limite 1MB) sem precisar
// do Firebase Storage (que exige plano pago em projetos novos).
async function compressImage(file, maxSize = 512, quality = 0.85) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // JPEG não tem transparência; evita fundo preto em PNGs
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', quality);
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

  $('btn-logout').addEventListener('click', () => runWithSpinner($('btn-logout'), async () => {
    try { await signOut(auth); } catch { /* onAuthStateChanged trata */ }
  }, 'Saindo...'));

  // Preview
  $('btn-toggle-preview').addEventListener('click', togglePreview);
  $('btn-close-preview').addEventListener('click', () => setPreview(false));
  $('btn-reload-preview').addEventListener('click', () => {
    const f = $('preview-frame');
    if (f) { previewReady = false; f.src = f.src; }
  });
  const pf = $('preview-frame');
  pf.addEventListener('load', () => { previewReady = true; updatePreview(); });
  try {
    if (pf.contentDocument && pf.contentDocument.readyState === 'complete') previewReady = true;
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
    bioConfig.photo       = getPhotoValue();
    await persist('Perfil salvo!');
  }, 'Salvando...'));

  // Upload de foto
  $('btn-upload-photo').addEventListener('click', () => $('file-photo').click());
  $('file-photo').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = ''; // permite escolher o mesmo arquivo de novo
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Escolha um arquivo de imagem.', 'error'); return; }
    await runWithSpinner($('btn-upload-photo'), async () => {
      try {
        const dataUrl = await compressImage(file);
        if (dataUrl.length > 900000) { toast('Imagem grande demais mesmo após compressão.', 'error'); return; }
        photoData = dataUrl;
        $('field-photo').value = '';
        bioConfig.photo = dataUrl;
        updatePhotoThumb();
        updatePreview();
        toast('Imagem carregada — clique em "Salvar Perfil" para aplicar.', 'info');
      } catch (err) {
        console.error('[Admin] Erro ao processar imagem:', err);
        toast('Não foi possível ler esta imagem. Tente JPG ou PNG.', 'error');
      }
    }, 'Processando...');
  });

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
  // Alterar senha (reautentica e atualiza no Firebase)
  $('btn-change-pass').addEventListener('click', () => runWithSpinner($('btn-change-pass'), async () => {
    const cur = $('sec-current').value;
    const nw  = $('sec-new').value;
    const cf  = $('sec-confirm').value;
    if (!currentUser) { toast('Sessão expirada. Faça login novamente.', 'error'); return; }
    if (nw.length < 6) { toast('Nova senha deve ter ao menos 6 caracteres.', 'error'); return; }
    if (nw !== cf)     { toast('As senhas não coincidem.', 'error'); return; }
    try {
      const cred = EmailAuthProvider.credential(currentUser.email, cur);
      await withTimeout(reauthenticateWithCredential(currentUser, cred), AUTH_TIMEOUT, 'reauth');
      await withTimeout(updatePassword(currentUser, nw), AUTH_TIMEOUT, 'updatePass');
      $('sec-current').value = $('sec-new').value = $('sec-confirm').value = '';
      toast('Senha atualizada!', 'success');
    } catch (err) {
      console.error('[Admin] Erro ao trocar senha:', err);
      toast(authErrorMsg(err), 'error');
    }
  }, 'Salvando...'));

  // Enviar link de redefinição para o e-mail logado
  $('btn-send-reset').addEventListener('click', () => runWithSpinner($('btn-send-reset'), async () => {
    if (!currentUser?.email) { toast('Sessão expirada.', 'error'); return; }
    try {
      await withTimeout(sendPasswordResetEmail(auth, currentUser.email), AUTH_TIMEOUT, 'reset');
      toast('Link de redefinição enviado para ' + currentUser.email, 'success');
    } catch (err) {
      toast(authErrorMsg(err), 'error');
    }
  }, 'Enviando...'));
}

// ── Persist ───────────────────────────────────────────────────────────────────
async function persist(msg = 'Salvo!') {
  updatePreview();
  try {
    await saveConfig(bioConfig);
    toast(msg, 'success');
  } catch (e) {
    if (isTimeout(e)) toast('Salvo localmente — sincronizando com o servidor...', 'info');
    else if (String(e?.code).includes('permission-denied')) toast('Sem permissão para salvar. Revise as regras do Firestore.', 'error');
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
  bioConfig.photo       = getPhotoValue();
  bioConfig.statusText  = $('field-status-text').value;
  bioConfig.statusActive = $('field-status-active').checked;
  updatePhotoThumb();
  updatePreview();
}

function setPreview(on) {
  $('screen-dashboard').classList.toggle('preview-open', on);
  $('btn-toggle-preview').classList.toggle('active', on);
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

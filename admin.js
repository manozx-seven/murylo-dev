// ─────────────────────────────────────────────────────────────────────────────
// NÚCLEO DO PAINEL — genérico para qualquer template de bio.
// Nada aqui conhece os campos do modelo: a sidebar, as seções e os formulários
// são gerados a partir do schema do template (/templates/<id>/schema.js).
// Para criar um modelo novo de bio: nova pasta em /templates com schema.js,
// render.js e a página pública — o painel se adapta sozinho.
// ─────────────────────────────────────────────────────────────────────────────
import { db, auth, withTimeout, isTimeout } from './firebase.js';
import {
  doc, getDoc, setDoc, collection, query, where, limit, getDocs
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
  EmailAuthProvider, reauthenticateWithCredential, updatePassword
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

// Template do usuário logado — carregado dinamicamente conforme o campo
// `template` do documento da bio dele (multi-cliente: cada bio tem o seu).
let TEMPLATE = null;
const DEFAULT_TEMPLATE = 'dev-neon';

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
let bioSlug = null;        // id do documento da bio do usuário (bios/{slug})
let currentUser = null;
let inDashboard = false;
let modalSection = null;   // seção (do schema) sendo editada no modal
let editingId = null;
const uploadedImages = {}; // data URLs por campo de imagem; URL digitada tem prioridade

// ── Helpers ───────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Seções do schema que são formulários simples (têm `fields`)
const formSections = () => TEMPLATE.sections.filter(s => Array.isArray(s.fields));

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
// Cada cliente é um documento em bios/{slug}: os dados da bio + ownerUid (quem
// pode editar) + template (qual modelo o painel deve montar).
async function loadTemplate(id) {
  const mod = await import(`./templates/${id}/schema.js`);
  TEMPLATE = mod.default;
  return TEMPLATE;
}

// Procura a bio cujo dono é o usuário logado.
async function resolveBio(user) {
  const q = query(collection(db, 'bios'), where('ownerUid', '==', user.uid), limit(1));
  const rs = await withTimeout(getDocs(q), READ_TIMEOUT, 'resolveBio');
  if (rs.empty) return null;
  bioSlug = rs.docs[0].id;
  return rs.docs[0].data();
}

// Cria a bio do usuário no primeiro acesso. A primeira bio do sistema herda os
// dados do documento legado bio/config (migração do painel single-user).
async function createBio(slug) {
  const ref = doc(db, 'bios', slug);
  const existing = await withTimeout(getDoc(ref), READ_TIMEOUT, 'slugCheck');
  if (existing.exists()) throw new Error('slug-taken');

  let seed = null;
  const any = await withTimeout(getDocs(query(collection(db, 'bios'), limit(1))), READ_TIMEOUT, 'firstBio');
  if (any.empty) {
    const legacy = await withTimeout(getDoc(doc(db, 'bio', 'config')), READ_TIMEOUT, 'legacy');
    if (legacy.exists()) seed = legacy.data();
  }

  const tpl = await loadTemplate(DEFAULT_TEMPLATE);
  const cfg = {
    ...(seed || structuredClone(tpl.defaults)),
    ownerUid: currentUser.uid,
    ownerEmail: currentUser.email,
    template: DEFAULT_TEMPLATE,
  };
  await withTimeout(setDoc(ref, cfg), WRITE_TIMEOUT, 'createBio');
  bioSlug = slug;
  return cfg;
}

async function saveConfig(cfg) {
  await withTimeout(setDoc(doc(db, 'bios', bioSlug), cfg), WRITE_TIMEOUT, 'saveConfig');
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
        try {
          const cfg = await resolveBio(user);
          if (cfg) {
            await enterDashboard(cfg);
          } else {
            // Usuário sem bio: primeiro acesso — escolhe o endereço público.
            inDashboard = false;
            showScreen('screen-auth');
            showAuthPanel('panel-setup');
            $('setup-slug').focus();
          }
        } catch (e) {
          console.error('[Admin] Erro ao abrir dashboard:', e);
          inDashboard = false;
          showScreen('screen-auth');
          showAuthPanel('panel-login');
          $('login-error').textContent = 'Não foi possível carregar sua bio. Verifique a conexão e recarregue a página.';
        }
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

  // Primeiro acesso: criar a bio escolhendo o endereço público (slug)
  const RESERVED_SLUGS = ['admin', 'index', 'bio', 'bios', 'templates', 'login', 'api'];
  $('form-setup-el').addEventListener('submit', async e => {
    e.preventDefault();
    const slug = $('setup-slug').value.trim().toLowerCase();
    $('setup-error').textContent = '';
    if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(slug)) {
      $('setup-error').textContent = 'Use de 3 a 30 caracteres: letras minúsculas, números e hífens.';
      return;
    }
    if (RESERVED_SLUGS.includes(slug)) {
      $('setup-error').textContent = 'Este endereço é reservado. Escolha outro.';
      return;
    }
    await runWithSpinner($('btn-setup'), async () => {
      try {
        const cfg = await createBio(slug);
        inDashboard = true;
        await enterDashboard(cfg);
        toast('Bio criada! Este é o seu painel.', 'success');
      } catch (err) {
        console.error('[Admin] Erro ao criar bio:', err);
        if (String(err?.message) === 'slug-taken') $('setup-error').textContent = 'Este endereço já está em uso. Escolha outro.';
        else if (isTimeout(err)) $('setup-error').textContent = 'Falha de conexão. Tente novamente.';
        else if (String(err?.code).includes('permission-denied')) $('setup-error').textContent = 'Sem permissão. Atualize as regras do Firestore (veja a seção Segurança).';
        else $('setup-error').textContent = 'Não foi possível criar. Tente novamente.';
      }
    }, 'Criando...');
  });
  $('btn-setup-logout').addEventListener('click', async () => {
    try { await signOut(auth); } catch { /* onAuthStateChanged trata */ }
  });
}

// ── Geração da UI a partir do schema ────────────────────────────────────────────
function fieldHtml(f) {
  const hint = f.hint ? ` <span class="label-hint">(${esc(f.hint)})</span>` : '';
  const label = `<label>${esc(f.label)}${hint}</label>`;

  if (f.type === 'textarea') return `
    <div class="form-group">${label}
      <textarea id="field-${f.key}" rows="${f.rows || 3}" placeholder="${esc(f.placeholder || '')}"></textarea>
    </div>`;

  if (f.type === 'toggle') return `
    <div class="form-group toggle-group">${label}
      <label class="toggle">
        <input type="checkbox" id="field-${f.key}">
        <span class="toggle-slider"></span>
      </label>
    </div>`;

  if (f.type === 'image') return `
    <div class="form-group">${label}
      <div class="photo-row">
        <img id="thumb-${f.key}" class="photo-thumb" alt="Imagem atual">
        <div class="photo-actions">
          <button type="button" id="btn-upload-${f.key}" class="btn btn-secondary">
            <i class="fa-solid fa-image"></i> Trocar imagem
          </button>
          <span class="photo-hint">JPG, PNG ou WebP — redimensionada automaticamente.</span>
        </div>
        <input type="file" id="file-${f.key}" accept="image/*" class="hidden">
      </div>
      <label style="margin-top:12px">Ou use uma URL <span class="label-hint">(deixe vazio para manter a imagem enviada)</span></label>
      <input type="text" id="field-${f.key}" placeholder="arquivo.jpg ou https://...">
    </div>`;

  return `
    <div class="form-group">${label}
      <input type="text" id="field-${f.key}" placeholder="${esc(f.placeholder || '')}">
    </div>`;
}

function sectionHtml(s, active) {
  const cls = `admin-section${active ? ' active' : ''}`;

  if (Array.isArray(s.fields)) return `
    <section id="section-${s.id}" class="${cls}">
      <h2>${esc(s.title || s.label)}</h2>
      ${s.fields.map(fieldHtml).join('')}
      <button id="btn-save-${s.id}" class="btn btn-primary">
        <i class="fa-solid fa-floppy-disk"></i> ${esc(s.saveLabel || 'Salvar')}
      </button>
    </section>`;

  if (s.type === 'item-list') return `
    <section id="section-${s.id}" class="${cls}">
      <div class="section-header">
        <h2>${esc(s.title || s.label)}</h2>
        <button id="btn-add-${s.id}" class="btn btn-primary"><i class="fa-solid fa-plus"></i> Adicionar</button>
      </div>
      <div id="list-${s.id}" class="sortable-list"></div>
    </section>`;

  if (s.type === 'tag-list') return `
    <section id="section-${s.id}" class="${cls}">
      <h2>${esc(s.title || s.label)}</h2>
      <div id="list-${s.id}" class="tags-container"></div>
      <div class="add-tag-row">
        <div class="form-group" style="flex:1;margin-bottom:0">
          <input type="text" id="input-${s.id}" placeholder="Nova tag...">
        </div>
        <button id="btn-add-${s.id}" class="btn btn-primary" style="align-self:flex-end">
          <i class="fa-solid fa-plus"></i>
        </button>
      </div>
    </section>`;

  console.warn(`[Admin] Tipo de seção desconhecido no schema: ${s.type}`);
  return '';
}

let uiBuilt = false;
function buildUI() {
  if (uiBuilt) return;
  uiBuilt = true;
  // Seções do schema entram antes das fixas do núcleo (Segurança).
  document.querySelector('.admin-sidebar').insertAdjacentHTML('afterbegin',
    TEMPLATE.sections.map((s, i) =>
      `<button class="nav-item${i === 0 ? ' active' : ''}" data-section="${s.id}"><i class="${s.icon}"></i> ${esc(s.label)}</button>`
    ).join(''));
  document.querySelector('.admin-main').insertAdjacentHTML('afterbegin',
    TEMPLATE.sections.map((s, i) => sectionHtml(s, i === 0)).join(''));
}

// ── Leitura/escrita genérica de campos ──────────────────────────────────────────
function readField(f, trim = false) {
  if (f.type === 'toggle') return $(`field-${f.key}`).checked;
  if (f.type === 'image')  return imageValue(f.key);
  const v = $(`field-${f.key}`).value;
  return trim ? v.trim() : v;
}

function populateForms() {
  formSections().forEach(s => s.fields.forEach(f => {
    const v = bioConfig[f.key];
    if (f.type === 'toggle') { $(`field-${f.key}`).checked = !!v; return; }
    if (f.type === 'image') {
      // Imagem em base64 fica fora do input de URL (seria um texto gigante).
      const val = v || '';
      if (val.startsWith('data:image/')) { uploadedImages[f.key] = val; $(`field-${f.key}`).value = ''; }
      else { delete uploadedImages[f.key]; $(`field-${f.key}`).value = val; }
      updateThumb(f.key);
      return;
    }
    $(`field-${f.key}`).value = v ?? '';
  }));
}

// ── Imagem (upload + compressão) ────────────────────────────────────────────────
function imageValue(key) {
  return $(`field-${key}`).value.trim() || uploadedImages[key] || '';
}

function updateThumb(key) {
  const v = imageValue(key);
  if (v) $(`thumb-${key}`).src = v;
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

function bindImageField(f) {
  $(`btn-upload-${f.key}`).addEventListener('click', () => $(`file-${f.key}`).click());
  $(`file-${f.key}`).addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = ''; // permite escolher o mesmo arquivo de novo
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Escolha um arquivo de imagem.', 'error'); return; }
    await runWithSpinner($(`btn-upload-${f.key}`), async () => {
      try {
        const dataUrl = await compressImage(file);
        if (dataUrl.length > 900000) { toast('Imagem grande demais mesmo após compressão.', 'error'); return; }
        uploadedImages[f.key] = dataUrl;
        $(`field-${f.key}`).value = '';
        bioConfig[f.key] = dataUrl;
        updateThumb(f.key);
        updatePreview();
        toast('Imagem carregada — clique em salvar para aplicar.', 'info');
      } catch (err) {
        console.error('[Admin] Erro ao processar imagem:', err);
        toast('Não foi possível ler esta imagem. Tente JPG ou PNG.', 'error');
      }
    }, 'Processando...');
  });
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
let dashboardBound = false;

async function enterDashboard(cfg) {
  await loadTemplate(cfg.template || DEFAULT_TEMPLATE);
  bioConfig = cfg;
  buildUI();
  showScreen('screen-dashboard');
  populateForms();
  renderAllLists();
  buildIconPicker();
  if (!dashboardBound) { bindDashboard(); dashboardBound = true; }

  // Preview e "Ver Bio" apontam para a página pública DESTA bio.
  const pub = `${TEMPLATE.publicPage}?u=${encodeURIComponent(bioSlug)}`;
  $('btn-view-bio')?.setAttribute('href', pub);
  const pf = $('preview-frame');
  if (pf.getAttribute('src') !== pub) { previewReady = false; pf.src = pub; }

  updateAccountInfo();
  if (window.innerWidth >= 1100) setPreview(true);
  updatePreview();
}

function renderAllLists() {
  TEMPLATE.sections.forEach(s => {
    if (s.type === 'item-list') renderItemList(s);
    else if (s.type === 'tag-list') renderTagList(s);
  });
}

// ── Bind do dashboard (uma única vez) ───────────────────────────────────────────
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

  // Campos dos formulários: live preview + botão de salvar por seção
  formSections().forEach(s => {
    s.fields.forEach(f => {
      const el = $(`field-${f.key}`);
      el.addEventListener(f.type === 'toggle' ? 'change' : 'input', liveSync);
      if (f.type === 'image') bindImageField(f);
    });
    $(`btn-save-${s.id}`).addEventListener('click', () => runWithSpinner($(`btn-save-${s.id}`), async () => {
      s.fields.forEach(f => { bioConfig[f.key] = readField(f, true); });
      await persist(`${s.label} salvo!`);
    }, 'Salvando...'));
  });

  // Listas: botões de adicionar
  TEMPLATE.sections.forEach(s => {
    if (s.type === 'item-list') {
      $(`btn-add-${s.id}`).addEventListener('click', () => openModal(s, null));
    } else if (s.type === 'tag-list') {
      $(`btn-add-${s.id}`).addEventListener('click', () => runWithSpinner($(`btn-add-${s.id}`), () => addTag(s)));
      $(`input-${s.id}`).addEventListener('keydown', e => {
        if (e.key === 'Enter') runWithSpinner($(`btn-add-${s.id}`), () => addTag(s));
      });
    }
  });

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
  formSections().forEach(s => s.fields.forEach(f => {
    bioConfig[f.key] = readField(f);
    if (f.type === 'image') updateThumb(f.key);
  }));
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

// ── Listas de itens (links, redes sociais, ...) ─────────────────────────────────
function renderItemList(s) {
  const list = $(`list-${s.id}`);
  const items = s.sortable
    ? [...bioConfig[s.key]].sort((a, b) => a.order - b.order)
    : bioConfig[s.key];

  list.innerHTML = items.map(item => `
    <div class="list-item" ${s.sortable ? 'draggable="true"' : ''} data-id="${item.id}">
      ${s.sortable ? '<span class="drag-handle"><i class="fa-solid fa-grip-vertical"></i></span>' : ''}
      <div class="list-item-icon"><i class="${item.icon}"></i></div>
      <div class="list-item-info">
        <strong>${esc(item[s.titleKey] || '')}</strong>
        <span>${esc(item[s.subKey] || '')}</span>
      </div>
      <div class="list-item-actions">
        <label class="toggle" title="Ativar/desativar">
          <input type="checkbox" class="item-toggle" data-id="${item.id}" ${item.active ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
        <button class="btn-icon btn-icon-edit item-edit" data-id="${item.id}" title="Editar">
          <i class="fa-solid fa-pen"></i>
        </button>
        <button class="btn-icon btn-icon-delete item-delete" data-id="${item.id}" title="Remover">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    </div>`
  ).join('');

  list.querySelectorAll('.item-toggle').forEach(cb => {
    cb.addEventListener('change', async () => {
      const it = bioConfig[s.key].find(x => x.id === cb.dataset.id);
      if (it) { it.active = cb.checked; await persist(); }
    });
  });

  list.querySelectorAll('.item-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const it = bioConfig[s.key].find(x => x.id === btn.dataset.id);
      if (it) openModal(s, it);
    });
  });

  list.querySelectorAll('.item-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm(`Remover ${s.itemName.toLowerCase()}?`)) return;
      runWithSpinner(btn, async () => {
        bioConfig[s.key] = bioConfig[s.key].filter(x => x.id !== btn.dataset.id);
        renderItemList(s);
        await persist(`${s.itemName} removido.`);
      });
    });
  });

  if (s.sortable) bindDrag(list, s);
}

// ── Tags ──────────────────────────────────────────────────────────────────────
function renderTagList(s) {
  const container = $(`list-${s.id}`);
  container.innerHTML = (bioConfig[s.key] || []).map((tag, i) => `
    <span class="tag-chip">
      ${esc(tag)}
      <button data-i="${i}" title="Remover"><i class="fa-solid fa-xmark"></i></button>
    </span>`
  ).join('');

  container.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', async () => {
      bioConfig[s.key].splice(Number(btn.dataset.i), 1);
      renderTagList(s);
      await persist('Tag removida.');
    });
  });
}

async function addTag(s) {
  const input = $(`input-${s.id}`);
  const val = input.value.trim();
  if (!val) return;
  bioConfig[s.key].push(val);
  input.value = '';
  renderTagList(s);
  await persist('Tag adicionada.');
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openModal(s, data) {
  modalSection = s;
  editingId = data?.id || null;

  $('modal-title').textContent    = `${data ? 'Editar' : 'Adicionar'} ${s.itemName}`;
  $('modal-field-title').value    = data?.[s.titleKey] || '';
  $('modal-field-subtitle').value = data?.subtitle || '';
  $('modal-field-handle').value   = data?.handle   || '';
  $('modal-field-url').value      = data?.url      || '';
  $('modal-field-icon').value     = data?.icon     || '';
  $('modal-field-active').checked = data?.active !== false;

  $('modal-group-subtitle').style.display = s.modal?.subtitle ? '' : 'none';
  $('modal-group-handle').style.display   = s.modal?.handle   ? '' : 'none';

  syncIconPicker(data?.icon || '');
  const ov = $('modal-overlay');
  ov.classList.remove('hidden');
  ov.classList.remove('modal-anim'); void ov.offsetWidth; ov.classList.add('modal-anim');
  $('modal-field-title').focus();
}

function closeModal() { $('modal-overlay').classList.add('hidden'); }

async function saveModal() {
  const s = modalSection;
  if (!s) return;
  const title = $('modal-field-title').value.trim();
  const url   = $('modal-field-url').value.trim();
  const icon  = $('modal-field-icon').value.trim() || 'fa-solid fa-link';

  if (!title || !url) { toast('Título e URL são obrigatórios.', 'error'); return; }

  const item = { [s.titleKey]: title, url, icon, active: $('modal-field-active').checked };
  if (s.modal?.subtitle) item.subtitle = $('modal-field-subtitle').value.trim();
  if (s.modal?.handle)   item.handle   = $('modal-field-handle').value.trim();

  const arr = bioConfig[s.key];
  if (editingId) {
    const it = arr.find(x => x.id === editingId);
    if (it) Object.assign(it, item);
  } else {
    const novo = { id: uid(), ...item };
    if (s.sortable) novo.order = arr.reduce((m, x) => Math.max(m, x.order ?? -1), -1) + 1;
    arr.push(novo);
  }

  renderItemList(s);
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

// ── Drag to reorder ───────────────────────────────────────────────────────────
function bindDrag(list, s) {
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

      const arr = bioConfig[s.key];
      const from = arr.findIndex(x => x.id === dragId);
      const to   = arr.findIndex(x => x.id === targetId);
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      arr.forEach((x, i) => { if ('order' in x) x.order = i; });

      renderItemList(s);
      await persist('Ordem atualizada.');
    });
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────────
initAuth();

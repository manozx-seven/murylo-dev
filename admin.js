import { db } from './firebase.js';
import {
  doc, getDoc, setDoc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ── Constantes ────────────────────────────────────────────────────────────────
const SESSION_KEY  = 'bio_admin_sess';
const SESSION_TTL  = 8 * 60 * 60 * 1000; // 8 horas
const FAIL_KEY     = 'bio_admin_fails';
const MAX_FAILS    = 5;
const LOCKOUT_MS   = 30 * 60 * 1000; // 30 min

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
let modalMode = 'link'; // 'link' | 'social'
let editingId = null;

// ── Helpers ───────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
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
  _toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}

// ── Firestore ─────────────────────────────────────────────────────────────────
async function loadAuth() {
  const snap = await getDoc(doc(db, 'admin', 'auth'));
  return snap.exists() ? snap.data() : null;
}

async function saveAuth(hash) {
  await setDoc(doc(db, 'admin', 'auth'), { hash });
}

async function loadConfig() {
  const snap = await getDoc(doc(db, 'bio', 'config'));
  return snap.exists() ? snap.data() : null;
}

async function saveConfig(cfg) {
  await setDoc(doc(db, 'bio', 'config'), cfg);
}

// ── Auth screens ──────────────────────────────────────────────────────────────
function showScreen(id) {
  ['screen-auth', 'screen-dashboard'].forEach(s => {
    $(s).classList.toggle('hidden', s !== id);
  });
}

async function initAuth() {
  if (hasSession()) {
    try { await enterDashboard(); return; }
    catch { clearSession(); }
  }

  let auth = null;
  try {
    auth = await loadAuth();
  } catch (e) {
    // Firestore indisponível — mostra login com aviso de regras
    $('login-error').textContent =
      '⚠️ Erro de conexão com o Firestore. Verifique se as regras do banco estão configuradas para permitir leitura e escrita.';
    bindLogin(true);
    showScreen('screen-auth');
    return;
  }

  if (!auth) {
    $('form-login').classList.add('hidden');
    $('form-setup').classList.remove('hidden');
    bindSetup();
  } else {
    bindLogin(false);
  }
  showScreen('screen-auth');
}

function bindSetup() {
  $('btn-setup').addEventListener('click', async () => {
    const p = $('setup-pass').value;
    const c = $('setup-confirm').value;
    $('setup-error').textContent = '';

    if (p.length < 6)      { $('setup-error').textContent = 'Senha deve ter ao menos 6 caracteres.'; return; }
    if (p !== c)            { $('setup-error').textContent = 'As senhas não coincidem.'; return; }

    $('btn-setup').disabled = true;
    $('btn-setup').textContent = 'Salvando...';
    try {
      await saveAuth(await sha256(p));
      saveSession();
      await enterDashboard();
    } catch {
      $('setup-error').textContent = 'Erro ao salvar. Tente novamente.';
      $('btn-setup').disabled = false;
      $('btn-setup').textContent = 'Criar Senha';
    }
  });
}

function bindLogin(firestoreError = false) {
  const doLogin = async () => {
    if (isLocked()) {
      $('login-error').textContent = 'Muitas tentativas. Aguarde 30 minutos.';
      return;
    }
    const p = $('login-pass').value;
    if (!p) { $('login-error').textContent = 'Informe a senha.'; return; }

    $('btn-login').disabled = true;
    $('btn-login').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verificando...';
    $('login-error').textContent = '';

    try {
      const auth = await loadAuth();
      if (!auth) {
        $('login-error').textContent = 'Nenhuma senha cadastrada. Recarregue a página.';
        return;
      }
      const hash = await sha256(p);
      if (auth.hash === hash) {
        clearFails();
        saveSession();
        await enterDashboard();
        return; // sucesso — não reabilita o botão (já trocou de tela)
      } else {
        const n = addFail();
        const left = MAX_FAILS - n;
        $('login-error').textContent = left > 0
          ? `Senha incorreta. ${left} tentativa(s) restante(s).`
          : 'Conta bloqueada por 30 minutos.';
        $('login-pass').value = '';
      }
    } catch (e) {
      $('login-error').textContent =
        '⚠️ Erro de conexão. Verifique as regras do Firestore e tente novamente.';
      console.error('[Admin] Erro no login:', e);
    }

    $('btn-login').disabled = false;
    $('btn-login').innerHTML = 'Entrar';
  };

  $('btn-login').addEventListener('click', doLogin);
  $('login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
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

async function enterDashboard() {
  showScreen('screen-dashboard');
  try {
    const cfg = await loadConfig();
    bioConfig = cfg || DEFAULT_CONFIG;
  } catch (e) {
    console.error('[Admin] Erro ao carregar config:', e);
    toast('Erro ao carregar dados do Firestore. Verifique as regras do banco.', 'error');
    bioConfig = DEFAULT_CONFIG;
  }
  populateForms();
  renderLinks();
  renderTags();
  renderSocial();
  buildIconPicker();
  bindDashboard();
}

function populateForms() {
  $('field-name').value        = bioConfig.name;
  $('field-role').value        = bioConfig.role;
  $('field-description').value = bioConfig.description;
  $('field-photo').value       = bioConfig.photo;
  $('field-status-text').value = bioConfig.statusText;
  $('field-status-active').checked = bioConfig.statusActive;
}

// ── Section navigation ────────────────────────────────────────────────────────
function bindDashboard() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      $(`section-${btn.dataset.section}`).classList.add('active');
    });
  });

  $('btn-logout').addEventListener('click', () => {
    clearSession();
    location.reload();
  });

  // Perfil
  $('btn-save-perfil').addEventListener('click', async () => {
    bioConfig.name        = $('field-name').value.trim();
    bioConfig.role        = $('field-role').value.trim();
    bioConfig.description = $('field-description').value.trim();
    bioConfig.photo       = $('field-photo').value.trim();
    await persist('Perfil salvo!');
  });

  // Status
  $('btn-save-status').addEventListener('click', async () => {
    bioConfig.statusText   = $('field-status-text').value.trim();
    bioConfig.statusActive = $('field-status-active').checked;
    await persist('Status salvo!');
  });

  // Links
  $('btn-add-link').addEventListener('click', () => openModal('link', null));

  // Tags
  $('btn-add-tag').addEventListener('click', addTag);
  $('new-tag-input').addEventListener('keydown', e => { if (e.key === 'Enter') addTag(); });

  // Social
  $('btn-add-social').addEventListener('click', () => openModal('social', null));

  // Modal
  $('modal-close').addEventListener('click', closeModal);
  $('modal-cancel').addEventListener('click', closeModal);
  $('modal-overlay').addEventListener('click', e => { if (e.target === $('modal-overlay')) closeModal(); });
  $('modal-save').addEventListener('click', saveModal);

  // Icon field sync
  $('modal-field-icon').addEventListener('input', () => {
    syncIconPicker($('modal-field-icon').value.trim());
  });
}

// ── Persist ───────────────────────────────────────────────────────────────────
async function persist(msg = 'Salvo!') {
  try {
    await saveConfig(bioConfig);
    toast(msg, 'success');
  } catch {
    toast('Erro ao salvar. Verifique a conexão.', 'error');
  }
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
    btn.addEventListener('click', async () => {
      if (!confirm('Remover este link?')) return;
      bioConfig.links = bioConfig.links.filter(l => l.id !== btn.dataset.id);
      renderLinks();
      await persist('Link removido.');
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
    btn.addEventListener('click', async () => {
      if (!confirm('Remover esta rede social?')) return;
      bioConfig.social = bioConfig.social.filter(x => x.id !== btn.dataset.id);
      renderSocial();
      await persist('Rede social removida.');
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

  // Mostrar/ocultar campos conforme o modo
  $('modal-group-subtitle').style.display = mode === 'link'   ? '' : 'none';
  $('modal-group-handle').style.display   = mode === 'social' ? '' : 'none';

  syncIconPicker(data?.icon || '');
  $('modal-overlay').classList.remove('hidden');
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

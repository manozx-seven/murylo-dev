// ─────────────────────────────────────────────────────────────────────────────
// Núcleo da página pública — genérico para qualquer template.
// O que é específico do modelo (campos e visual) mora em /templates/<id>/:
// o schema fornece os defaults e o render.js sabe desenhar a página.
//
// Estratégia anti-flash: o <body> começa com a classe `bio-loading` (conteúdo
// escondido + spinner). Só revelamos a página quando temos conteúdo REAL para
// mostrar — do cache local (instantâneo p/ dono/visitante recorrente), do
// preview do painel, ou do Firestore. Os defaults do template são apenas a
// última alternativa (Firestore indisponível E sem cache), nunca o 1º quadro.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from './firebase.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import TEMPLATE from './templates/dev-neon/schema.js';
import { renderBio } from './templates/dev-neon/render.js';

// Revela a página (esconde o loader). Idempotente.
function reveal() { document.body.classList.remove('bio-loading'); }

// ── Multi-cliente ──────────────────────────────────────────────────────────────
// Cada cliente é um documento em bios/{slug}. O slug vem da URL:
//   site.com/?u=ana-studio   (query string — funciona em qualquer hospedagem)
//   site.com/ana-studio      (caminho — precisa do rewrite no _redirects)
// Sem slug na URL, mostra a bio padrão do dono do site (DEFAULT_SLUG).
const DEFAULT_SLUG = 'murylo-bio';

function detectSlug() {
  const q = new URLSearchParams(location.search).get('u');
  if (q) return q.toLowerCase();
  const last = location.pathname.split('/').filter(Boolean).pop() || '';
  if (last && !last.includes('.')) return last.toLowerCase();
  return DEFAULT_SLUG;
}

const slug = detectSlug();
const CACHE_KEY = 'bio:' + slug;

// 1. Pinta na hora a última versão vista (cache local), se houver — sem esperar
//    a rede e sem flash de conteúdo padrão. O dono e quem já visitou veem o
//    conteúdo real imediatamente. Em seguida o Firestore reconcilia (passo 3).
let painted = false;
try {
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) { renderBio(JSON.parse(cached)); painted = true; reveal(); }
} catch { /* localStorage indisponível/corrompido — segue para o loader */ }

// ── Preview ao vivo ──────────────────────────────────────────────────────────
// Quando esta página é carregada dentro do painel (iframe), o admin envia o
// estado atual (ainda não salvo) via postMessage para refletir as edições em
// tempo real. Assim que recebemos uma prévia, ignoramos o que vier do Firestore
// para não sobrescrever o que o usuário está editando. Preview NÃO é cacheado
// (é conteúdo transitório, ainda não salvo).
let livePreview = false;
window.addEventListener('message', e => {
  const data = e.data;
  if (data && data.type === 'bio-preview' && data.config) {
    livePreview = true;
    renderBio(data.config);
    reveal();
  }
});

// 2. Busca o conteúdo real no Firestore e reconcilia com o que já está na tela.
(async () => {
  try {
    let snap = await getDoc(doc(db, 'bios', slug));
    // Fallback: documento legado de antes da migração multi-cliente
    if (!snap.exists()) snap = await getDoc(doc(db, 'bio', 'config'));

    if (snap.exists()) {
      const data = snap.data();
      if (!livePreview) renderBio(data);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* cota cheia — ignora */ }
    } else if (!painted && !livePreview) {
      // Sem doc e sem cache: cai nos defaults do template (última alternativa).
      renderBio(TEMPLATE.defaults);
    }
  } catch {
    // Firestore indisponível: se nada foi pintado ainda, mostra os defaults
    // para a página não ficar vazia.
    if (!painted && !livePreview) renderBio(TEMPLATE.defaults);
  } finally {
    reveal();
  }
})();

// ─────────────────────────────────────────────────────────────────────────────
// Núcleo da página pública — genérico para qualquer template.
// O que é específico do modelo (campos e visual) mora em /templates/<id>/:
// o schema fornece os defaults e o render.js sabe desenhar a página.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from './firebase.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import TEMPLATE from './templates/dev-neon/schema.js';
import { renderBio } from './templates/dev-neon/render.js';

// Renderiza defaults imediatamente (sem flash), depois atualiza do Firestore
renderBio(TEMPLATE.defaults);

// ── Preview ao vivo ────────────────────────────────────────────────────────────
// Quando esta página é carregada dentro do painel (iframe), o admin envia o
// estado atual (ainda não salvo) via postMessage para refletir as edições em
// tempo real. Assim que recebemos uma prévia, ignoramos o que vier do Firestore
// para não sobrescrever o que o usuário está editando.
let livePreview = false;
window.addEventListener('message', e => {
  const data = e.data;
  if (data && data.type === 'bio-preview' && data.config) {
    livePreview = true;
    renderBio(data.config);
  }
});

// ── Multi-cliente ──────────────────────────────────────────────────────────────
// Cada cliente é um documento em bios/{slug}. O slug vem da URL:
//   site.com/?u=ana-studio   (query string — funciona em qualquer hospedagem)
//   site.com/ana-studio      (caminho — precisa do rewrite no _redirects)
// Sem slug na URL, mostra a bio padrão do dono do site (DEFAULT_SLUG).
const DEFAULT_SLUG = 'murylo';

function detectSlug() {
  const q = new URLSearchParams(location.search).get('u');
  if (q) return q.toLowerCase();
  const last = location.pathname.split('/').filter(Boolean).pop() || '';
  if (last && !last.includes('.')) return last.toLowerCase();
  return DEFAULT_SLUG;
}

(async () => {
  try {
    let snap = await getDoc(doc(db, 'bios', detectSlug()));
    // Fallback: documento legado de antes da migração multi-cliente
    if (!snap.exists()) snap = await getDoc(doc(db, 'bio', 'config'));
    if (snap.exists() && !livePreview) renderBio(snap.data());
  } catch {
    // Firestore indisponível — mantém defaults já renderizados
  }
})();

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

(async () => {
  try {
    const snap = await getDoc(doc(db, 'bio', 'config'));
    if (snap.exists() && !livePreview) renderBio(snap.data());
  } catch {
    // Firestore indisponível — mantém defaults já renderizados
  }
})();

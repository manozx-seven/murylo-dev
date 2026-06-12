// Renderização da página pública do template "Dev Neon".
// Contrato com o núcleo: exportar renderBio(config) — é o que o data-loader
// chama com os defaults, com os dados do Firestore e com o preview ao vivo.
export function renderBio(cfg) {
  const $ = id => document.getElementById(id);

  const name = $('bio-name');
  if (name) name.textContent = cfg.name;

  const role = $('bio-role');
  if (role) role.innerHTML = `&lt;${cfg.role}/&gt;`;

  const desc = $('bio-description');
  if (desc) desc.textContent = cfg.description;

  const photo = $('bio-photo');
  if (photo) { photo.src = cfg.photo; photo.alt = cfg.name; }

  const badge = $('bio-status-badge');
  if (badge) badge.style.display = cfg.statusActive ? '' : 'none';

  const statusText = $('bio-status-text');
  if (statusText) statusText.textContent = cfg.statusText;

  const tags = $('bio-tags');
  if (tags) {
    tags.innerHTML = cfg.tags.map(t =>
      `<span class="px-2 py-1 bg-white/5 backdrop-blur-sm rounded-md border border-white/10">${t}</span>`
    ).join('');
  }

  const linksEl = $('bio-links');
  if (linksEl) {
    const delays = ['delay-1', 'delay-2', 'delay-3', 'delay-4'];
    const sorted = [...cfg.links].filter(l => l.active).sort((a, b) => a.order - b.order);
    linksEl.innerHTML = sorted.map((link, i) => `
      <a href="${link.url}" target="_blank" rel="noopener noreferrer"
         class="link-item glass-panel flex items-center p-3 pr-5 rounded-2xl fade-in ${delays[i] || ''} group">
        <div class="w-12 h-12 rounded-xl icon-box flex items-center justify-center text-slate-300 mr-4">
          <i class="${link.icon} text-xl"></i>
        </div>
        <div class="flex-1">
          <h3 class="font-semibold text-white text-base">${link.title}</h3>
          <p class="text-xs text-slate-400 font-code">${link.subtitle}</p>
        </div>
        <i class="fa-solid fa-arrow-right text-slate-500 group-hover:text-sky-400 group-hover:-rotate-45 transition-all duration-300"></i>
      </a>`
    ).join('');
  }

  const socialEl = $('bio-social');
  if (socialEl) {
    socialEl.innerHTML = cfg.social.filter(s => s.active).map(s => `
      <a href="${s.url}" target="_blank" rel="noopener noreferrer"
         class="glass-panel flex items-center gap-2 text-slate-400 hover:text-pink-500 transition-colors px-4 py-2 rounded-full border border-white/10 shadow-sm text-xs font-semibold group">
        <i class="${s.icon} text-sm group-hover:scale-110 transition-transform"></i>
        <span>${s.handle}</span>
      </a>`
    ).join('');
  }
}

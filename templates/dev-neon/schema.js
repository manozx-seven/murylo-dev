// ─────────────────────────────────────────────────────────────────────────────
// Template "Dev Neon" — descreve quais campos este modelo de bio possui.
// O painel admin lê este arquivo e gera o formulário sozinho: um modelo novo
// de bio = uma pasta nova em /templates com schema.js + render.js + a página
// pública. Nenhuma mudança no painel é necessária.
//
// Tipos de campo suportados pelo painel:
//   text       → input de texto simples
//   textarea   → texto longo (aceita `rows`)
//   toggle     → liga/desliga (boolean)
//   image      → upload com compressão (base64) ou URL
//   item-list  → lista de itens com modal de edição (título, url, ícone...)
//                opções: titleKey, subKey, sortable, modal: { subtitle, handle }
//   tag-list   → lista de textos curtos (chips)
// ─────────────────────────────────────────────────────────────────────────────
export default {
  id: 'dev-neon',
  name: 'Dev Neon',
  // Página pública deste template (usada no preview do painel e no botão "Ver Bio")
  publicPage: 'index.html',

  sections: [
    {
      id: 'perfil', label: 'Perfil', icon: 'fa-solid fa-user', saveLabel: 'Salvar Perfil',
      fields: [
        { key: 'name',        label: 'Nome',      type: 'text',     placeholder: 'Seu nome completo' },
        { key: 'role',        label: 'Função',    type: 'text',     hint: 'aparece como <Função/>', placeholder: 'Dev Web' },
        { key: 'description', label: 'Descrição', type: 'textarea', rows: 3, placeholder: 'Descreva o que você faz...' },
        { key: 'photo',       label: 'Foto',      type: 'image' },
      ],
    },
    {
      id: 'status', label: 'Status', icon: 'fa-solid fa-circle-dot', saveLabel: 'Salvar Status',
      fields: [
        { key: 'statusText',   label: 'Texto do Badge',         type: 'text', placeholder: 'Disponível para projetos' },
        { key: 'statusActive', label: 'Exibir badge de status', type: 'toggle' },
      ],
    },
    {
      id: 'links', label: 'Links', icon: 'fa-solid fa-link',
      type: 'item-list', key: 'links',
      itemName: 'Link', titleKey: 'title', subKey: 'subtitle',
      sortable: true,
      modal: { subtitle: true, handle: false },
    },
    {
      id: 'tags', label: 'Tags', icon: 'fa-solid fa-tags',
      type: 'tag-list', key: 'tags', title: 'Tags de Serviços',
    },
    {
      id: 'social', label: 'Redes Sociais', icon: 'fa-solid fa-share-nodes',
      type: 'item-list', key: 'social',
      itemName: 'Rede Social', titleKey: 'platform', subKey: 'handle',
      sortable: false,
      modal: { subtitle: false, handle: true },
    },
  ],

  defaults: {
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
      { id: '3', title: 'Fale comigo', subtitle: 'Orçamentos via WhatsApp', url: 'https://wa.me/5592992866146?text=Olá,%20Murylo!%20Gostaria%20de%20conversar%20sobre%20um%20projeto.', icon: 'fa-brands fa-whatsapp', active: true, order: 2 },
    ],
    social: [
      { id: '1', platform: 'Instagram', handle: '@murylo.dev', url: 'https://instagram.com/murylo.dev', icon: 'fa-brands fa-instagram', active: true },
    ],
  },
};

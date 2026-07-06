# CONTEXT — site público das bios (repo `murylo-dev`)

> Contexto deste repositório e do seu **contrato com o painel** (`biolink-painel`).
> Leia junto com o `CRIAR-MODELO.md` (como deixar um modelo pronto para o painel).

---

## 1. O que é este repositório

Esta pasta (`Desktop\bio`, repo **`murylo-dev`**, publicada em `murylo-bio.netlify.app`) é o
**site público das bios** — a página que o visitante vê quando abre o link do Instagram.

Ele tem dois papéis:

1. **É a bio pessoal do Murylo** (o slug padrão é `murylo-bio`).
2. **É o motor genérico** das páginas públicas: o núcleo (`data-loader.js`) sabe montar qualquer
   modelo a partir de `templates/<id>/`. Um modelo novo = uma pasta nova em `templates/`.

⚠️ **Este repositório NÃO é o painel.** O painel de edição é outro repo (`biolink-painel`,
publicado em `biolink-painel.netlify.app`). Os dois conversam pelo **Firestore** e por **preview**.

---

## 2. Os dois produtos (com painel × sem painel)

Nem todo cliente compra o painel. São **dois modos de entrega**:

### A) Bio SEM painel (só o link)

O cliente compra só o bio link pronto. **Eu (admin) monto tudo** e entrego o link publicado.

- Existe um documento `bios/{slug}` no Firestore (dono: **eu/admin**) com o conteúdo dele.
- **Eu edito** esse conteúdo pelo painel (é minha bio na lista de bios do admin).
- O cliente recebe **só a URL pública** — não recebe login nem código de acesso.
- Se um dia ele quiser o painel, aí sim faço o esquema do modo B (convite + login + adoção).

### B) Bio COM painel (cliente edita sozinho)

O cliente ganha acesso ao painel para editar a própria bio.

- Fluxo completo "admin monta, cliente adota": gero convite → monto a bio → crio login no
  Firebase → envio login + código → cliente loga, digita o código e **adota** a bio.
- Passo a passo detalhado: ver **`RUNBOOK.md`** no repo `biolink-painel`.

> Em ambos os casos o **site público é o mesmo** (este repo). A diferença é só **quem edita** e se
> o cliente recebe ou não acesso ao painel.

---

## 3. Contrato com o painel (como os dois se conectam)

O site público e o painel **nunca se importam diretamente** — eles se conectam por 3 pontos:

| Ponto de conexão | Como funciona |
|---|---|
| **Firestore `bios/{slug}`** | O painel **grava** o conteúdo; o site público **lê** e desenha. |
| **`publicUrl`** | Campo no doc da bio com a URL deste site. Liga o preview e o botão "Ver Bio". |
| **Preview ao vivo** | O painel abre este site num iframe e manda `postMessage({type:'bio-preview', config})`. O `data-loader.js` escuta e redesenha em tempo real, sem salvar. |

**As chaves dos campos precisam bater** entre o `schema.js` (painel) e o `render.js` (aqui). É o
ponto mais importante — ver `CRIAR-MODELO.md`.

### Firebase (mesmo projeto dos dois lados)

`firebase.js` aponta para **`painel-admin-bio-79c53`** — o **mesmo** projeto do painel. Se este
arquivo apontar para outro projeto, o site lê de um banco onde o painel não grava (bug clássico
que já aconteceu na migração). Mantê-los iguais é obrigatório.

### Slug (qual bio carregar)

`data-loader.js` decide qual `bios/{slug}` carregar a partir da URL:

- `site.com/?u=ana-studio` → slug `ana-studio` (query string; funciona em qualquer hospedagem).
- `site.com/ana-studio` → slug pelo caminho (precisa do `_redirects` do Netlify).
- Sem slug na URL → `DEFAULT_SLUG` (`murylo-bio`, a bio do dono do site).

---

## 4. Anti-flash (mudança de 2026-07-06)

Antes, a página mostrava o conteúdo padrão/antigo e só depois trocava pelo real do Firestore
(um "pisca"). Agora:

- O `<body>` começa com a classe **`bio-loading`** (conteúdo escondido + spinner) — ver `style.css`.
- O `data-loader.js` só revela a página quando tem conteúdo **REAL**: **cache local**
  (`localStorage['bio:'+slug]`, instantâneo para dono/visitante recorrente) → **preview** →
  **Firestore** (que atualiza o cache). Os `defaults` do template viram só última alternativa.
- Uma **rede de segurança** (`setTimeout` de 8s no `index.html`) revela a página mesmo se o JS
  falhar, para nunca ficar presa no loader.

**Consequência para modelos novos:** qualquer modelo que use este `data-loader.js` + `index.html`
com a classe `bio-loading` e o `<div class="bio-loader">` já herda o anti-flash de graça.

---

## 5. Deploy (importante)

- **Cada bio é um repositório próprio no GitHub conectado ao Netlify.** Push na branch de deploy
  (`main`) → o Netlify redeploya sozinho. **Sem push, nada vai ao ar.**
- ⚠️ **Bloqueio atual (desde 2026-07-03):** o Netlify do time está **sem créditos**; os deploys
  estão travados. Commits sobem para o GitHub, mas o site ao vivo só atualiza quando o deploy
  voltar (regularizar billing ou migrar para Cloudflare Pages).

---

## 6. Arquivos deste repositório

```
Desktop\bio/
├── index.html          # a página pública (marcação + ids que o render.js preenche)
├── style.css           # estilo (inclui o loader anti-flash)
├── script.js           # efeitos (canvas de partículas, copiar link...)
├── data-loader.js      # NÚCLEO genérico: slug → Firestore → render; preview; anti-flash
├── firebase.js         # config do Firebase (mesmo projeto do painel)
├── _redirects          # Netlify: URLs bonitas por cliente (/slug → index.html)
├── murylo.jpg          # foto padrão (bio do dono)
├── CONTEXT.md          # (este arquivo)
├── CRIAR-MODELO.md     # como deixar um modelo pronto para o painel
└── templates/
    └── dev-neon/
        ├── schema.js   # defaults + definição dos campos (espelha o schema do painel)
        └── render.js   # renderBio(cfg): desenha o modelo a partir do config
```

> Há também uma cópia antiga do painel aqui (`admin.html`, `admin.js`) — o painel **oficial** é o
> repo `biolink-painel`. Não edite a cópia antiga.

# CRIAR MODELO — como deixar um modelo pronto para o painel

> Checklist e contrato para um modelo de bio funcionar com o painel (`biolink-painel`).
> Contexto geral: ver `CONTEXT.md`.

---

## A regra de ouro: as chaves têm que bater

Um modelo funciona quando **três lugares concordam sobre os MESMOS nomes de campo (chaves)**:

```
   PAINEL                         SITE PÚBLICO (este repo)
   biolink-painel/                Desktop\bio/
   templates/<id>/schema.js  ⇄   templates/<id>/schema.js   (mesmas chaves + defaults)
                                  templates/<id>/render.js   (lê cfg.<chave> e desenha)
                                  index.html                 (ids que o render.js preenche)
```

Exemplo do `dev-neon`: a chave `name` aparece no schema (painel e site), o `render.js` faz
`cfg.name` e escreve no elemento `#bio-name` do `index.html`. Se qualquer um desses três usar um
nome diferente, o campo **não reflete** — é a causa nº 1 de "editei e não apareceu".

> ⚠️ **O `schema.js` existe em DOIS repos** (painel e site). Eles descrevem os mesmos campos, mas
> têm papéis diferentes: no **painel** gera o formulário; no **site** fornece os `defaults` e
> acompanha o `render.js`. Ao criar/alterar um modelo, edite os **dois**.

---

## Contrato de cada arquivo

### 1. `templates/<id>/schema.js` (aqui e no painel)

- `export default` com `id`, `name`, `sections[]` e `defaults{}`.
- `sections[]` descreve os campos editáveis. Tipos suportados pelo painel:
  - `text`, `textarea` (aceita `rows`), `toggle` (boolean), `image` (upload base64 ou URL).
  - `item-list` (lista com modal — links, redes): opções `titleKey`, `subKey`, `sortable`,
    `modal: { subtitle, handle }`.
  - `tag-list` (chips de texto curto).
- `defaults{}`: valores iniciais de cada chave. **No site**, usar dados neutros ou do dono; **no
  painel**, usar placeholders (ex.: "Sua Bio") — é o que semeia uma bio nova.

### 2. `templates/<id>/render.js` (só no site público)

- `export function renderBio(cfg)` — recebe o config (defaults, Firestore ou preview) e escreve no
  DOM. Contrato: ler `cfg.<chave>` e preencher os elementos do `index.html`.
- Regra de ouro do render: **sempre checar se o elemento existe** (`const el = $('id'); if (el) …`)
  para nunca quebrar se o HTML mudar.

### 3. `index.html` (só no site público)

- A marcação do modelo, com um `id` para cada campo que o `render.js` preenche
  (`bio-name`, `bio-photo`, `bio-links`...).
- **Para herdar o anti-flash**, o `<body>` deve ter a classe `bio-loading`, deve existir o
  `<div class="bio-loader"><div class="spinner"></div></div>` e a rede de segurança de 8s antes dos
  scripts. Basta copiar do `index.html` do `dev-neon`.
- Deve carregar `firebase.js`, `data-loader.js` (module) e o `style.css`.

### 4. Arquivos herdados (não precisa recriar por modelo)

`data-loader.js`, `firebase.js` e `_redirects` são **genéricos** — o modelo novo os reaproveita.
Só troque os imports do `data-loader.js` para apontar ao `schema.js`/`render.js` do modelo, se cada
modelo tiver seu deploy próprio.

---

## Passo a passo para um modelo novo

1. **Duplicar** a pasta `templates/dev-neon/` como `templates/<novo-id>/` (aqui e no painel).
2. Ajustar o **`schema.js`** dos dois lados: `id`, `name`, seções e `defaults` do modelo novo.
3. Escrever o **`render.js`** do modelo (lendo as chaves do schema e preenchendo o HTML).
4. Montar o **`index.html`** do modelo, com os `id`s certos e o bloco do loader (copiar do dev-neon).
5. Conferir que o **`firebase.js`** aponta para `painel-admin-bio-79c53`.
6. **Publicar**: repo no GitHub → conectar ao Netlify → copiar a URL (vira o `publicUrl`).
7. No painel, ao gerar o convite, informar `template = <novo-id>` e o `publicUrl` do passo 6.

---

## Checklist de "modelo pronto" (por modelo)

- [ ] `templates/<id>/schema.js` existe **nos dois repos** com as **mesmas chaves**
- [ ] `defaults{}` cobre **todas** as chaves usadas pelo `render.js`
- [ ] `render.js` lê `cfg.<chave>` de todos os campos e checa `if (el)` antes de escrever
- [ ] `index.html` tem um `id` para cada campo que o `render.js` preenche
- [ ] `index.html` tem o bloco do loader (`bio-loading` + `.bio-loader` + `setTimeout` 8s)
- [ ] `firebase.js` aponta para `painel-admin-bio-79c53` (mesmo projeto do painel)
- [ ] Preview testado: abrir a bio no painel e ver as edições refletindo ao vivo
- [ ] `publicUrl` do doc `bios/{slug}` preenchido com a URL publicada

---

## Erros comuns (e a causa)

| Sintoma | Causa provável |
|---|---|
| "Editei no painel e não apareceu" | Chave diferente entre `schema.js` (painel) e `render.js` (site) |
| Site mostra sempre o padrão | `firebase.js` aponta para o projeto errado, ou `bios/{slug}` não existe |
| Preview não aparece no painel | `publicUrl` vazio no doc da bio |
| Página "pisca" o conteúdo antigo | `index.html` sem o bloco do loader / `data-loader.js` desatualizado |
| Página fica no loader para sempre | Erro de JS no `render.js`/imports (a rede de segurança de 8s revela mesmo assim) |

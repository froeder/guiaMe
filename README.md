# GuiaMe SP 📍

> Descubra todos os eventos que acontecem em São Paulo — shows, teatro, exposições, gastronomia, tecnologia, aviação e muito mais.

🔗 **Repositório:** https://github.com/froeder/guiaMe

---

## ✨ Funcionalidades

- 🔍 **Busca** por título, local ou bairro
- 💰 **Filtro de preço** — Todos / Grátis / Pago
- 🗂️ **14 categorias** — Música, Teatro, Exposição, Cultura, Gastronomia, Esporte, Tecnologia, Aviação, Cinema, Dança, Literatura, Infantil, Festa, Outros
- 📅 **Calendário interativo** — clique num dia e veja só os eventos daquele dia
- ⭐ **Destaques** — seção hero com os eventos mais relevantes
- 📱 **PWA instalável** — funciona offline, ícone na tela inicial
- 🔄 **Atualização diária automática** com cache de 6h
- ♾️ **Infinite scroll** para carregar mais eventos

## 🌐 Fontes de Dados

| Fonte | Tipo |
|-------|------|
| [Sympla](https://sympla.com.br) | Scraping JSON-LD |
| [Eventbrite](https://eventbrite.com.br) | Scraping JSON-LD |
| [SESC São Paulo](https://sescsp.org.br) | Scraping Programação / Grátis |
| [Centro Cultural SP (CCSP)](https://centrocultural.sp.gov.br) | Scraping Agenda Cultural |
| [Pinacoteca de SP](https://pinacoteca.org.br) | Scraping Exposições |
| [Instituto Moreira Salles (IMS)](https://ims.com.br) | Scraping Exposições & Cinema |
| [Memorial da América Latina](https://memorial.org.br) | Scraping Festivais & Gastronomia |
| [MIS SP](https://mis-sp.org.br) | Scraping Museu da Imagem e do Som |
| [Ticket360](https://ticket360.com.br) | Scraping Shows & Baladas |
| [Ingresso.com SP](https://ingresso.com) | Scraping Cinema & Teatro |
| [Sampa.Art](https://sampa.art) | API pública de eventos |
| [Prefeitura SP](https://prefeitura.sp.gov.br) | Scraping Agenda Oficial |
| [G1 SP](https://g1.globo.com/sp/sao-paulo/agenda-de-eventos/) | Scraping Guia de Eventos |
| [Catraca Livre](https://catracalivre.com.br) | Scraping Cultura & Grátis |
| [SP Turismo](https://cidadedesaopaulo.com) | Scraping Guia Turístico |
| [Balada SP](https://balada.sp.gov.br) | Scraping Vida Noturna |

## 🚀 Stack

- **Frontend:** React 19 + TypeScript + Vite 8
- **PWA:** vite-plugin-pwa (Workbox)
- **Estilo:** CSS Modules + design system próprio (dark theme)
- **Hospedagem:** Firebase Hosting
- **Datas:** date-fns

## 🛠️ Como rodar localmente

```bash
# Instalar dependências
npm install

# Dev server
npm run dev

# Build de produção
npm run build

# Preview do build
npm run preview

# Regenerar ícones PWA
npm run icons
```

## 🔥 Deploy no Firebase

```bash
# 1. Build
npm run build

# 2. Deploy
npx firebase-tools deploy --only hosting
```

> Atualize o ID do projeto em `.firebaserc` com o seu projeto Firebase.

## 📁 Estrutura

```
src/
├── types/          # Tipos TypeScript (Event, EventCategory, etc.)
├── services/       # Agregador de eventos (fetchAllEvents, filterEvents)
├── utils/          # Config de categorias com cores e emojis
└── components/     # Header, FilterBar, EventCalendar, EventCard, Skeleton
```

## 📄 Licença

MIT

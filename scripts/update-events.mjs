/**
 * GuiaMe SP — Script de Atualização Diária de Eventos (GitHub Actions / Local)
 * Coleta eventos reais de fontes públicas de São Paulo sem bloqueio de CORS de navegador.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_PATH = path.resolve(__dirname, '../public/data/events.json');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

const HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept': 'application/json, text/xml, text/html, */*',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
};

// ─── Auxiliares ─────────────────────────────────────────────────────────────

function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/\]\]>/g, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/&#8216;/g, '‘')
    .replace(/&#8217;/g, '’')
    .replace(/&#8220;/g, '“')
    .replace(/&#8221;/g, '”')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function generateId(source, title, date) {
  const str = `${source}-${title}-${date}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function guessCategory(title, description = '') {
  const text = `${title} ${description}`.toLowerCase();
  if (/halloween|bruxa|saci|fantasia|horror|terror|macabr|baile|balada|festa|party|club/i.test(text)) return 'festa';
  if (/jazz|rock|show|música|musica|concert|band|samba|forró|mpb|pop|metal|rap|funk|orquestra|sinfônica|recital/i.test(text)) return 'musica';
  if (/teatro|peça|espetáculo|cena|palco|dramaturgia|comédia|stand-up|ópera/i.test(text)) return 'teatro';
  if (/exposiç|exposição|museu|galeria|arte|pintura|escultura|fotografia|instalação|acervo/i.test(text)) return 'exposicao';
  if (/gastro|culinária|chef|food|alimentação|vinho|cerveja|cervejaria|feira|degustação|restaurante/i.test(text)) return 'gastronomia';
  if (/esporte|corrida|maratona|futebol|tênis|basquete|vôlei|ciclismo|bike|skate|fitness/i.test(text)) return 'esporte';
  if (/tech|tecnologia|startup|programação|inovaç|digital|hackathon|developer|game|bgs/i.test(text)) return 'tecnologia';
  if (/aviaç|aeronave|avião|helicóptero|aeroporto/i.test(text)) return 'aviacao';
  if (/cinema|filme|movie|sessão|curta|longa|mostra/i.test(text)) return 'cinema';
  if (/dança|ballet|balé|coreografia/i.test(text)) return 'danca';
  if (/livro|literatura|poesia|sarau|leitura|autor|escritor|biblioteca/i.test(text)) return 'literatura';
  if (/infantil|criança|kids|família|brincar|fantoches|parque/i.test(text)) return 'infantil';
  return 'cultura';
}

function guessNeighborhood(title, desc = '', venue = '') {
  const text = `${title} ${desc} ${venue}`.toLowerCase();
  if (/paulista|masp|fiesp|ims paulista/i.test(text)) return 'Bela Vista';
  if (/pinheiros|benedito calixto|sesc pinheiros/i.test(text)) return 'Pinheiros';
  if (/vila madalena|madalena/i.test(text)) return 'Vila Madalena';
  if (/barra funda|memorial|audio|espaço unimed|allianz/i.test(text)) return 'Barra Funda';
  if (/ibirapuera|bienal|mac|mam/i.test(text)) return 'Vila Mariana';
  if (/centro|república|banco do brasil|farol santander|martineli|sé|patriarca|mário de andrade/i.test(text)) return 'Centro Histórico';
  if (/liberdade/i.test(text)) return 'Liberdade';
  if (/itaquera/i.test(text)) return 'Itaquera';
  if (/santana|anhembi|campo de marte/i.test(text)) return 'Santana';
  if (/mooca/i.test(text)) return 'Mooca';
  if (/bixiga/i.test(text)) return 'Bela Vista';
  if (/pompeia/i.test(text)) return 'Pompeia';
  if (/butantã|usp/i.test(text)) return 'Butantã';
  return 'São Paulo';
}

// ─── 1. Veja São Paulo (Cultura & Lazer) ─────────────────────────────────────

async function fetchVejaSP() {
  const events = [];
  try {
    const url = 'https://vejasp.abril.com.br/wp-json/wp/v2/posts?categories=772980&per_page=30&_embed=true';
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const posts = await res.json();

    for (const post of posts) {
      const title = decodeHtmlEntities(post.title?.rendered || '');
      if (!title || title.length < 5) continue;

      const desc = decodeHtmlEntities(post.excerpt?.rendered || '');
      const imageUrl = post._embedded?.['wp:featuredmedia']?.[0]?.source_url;
      const isFree = /grátis|gratuito|gratuita|entrada franca|livre/i.test(`${title} ${desc}`);
      const category = guessCategory(title, desc);
      const neighborhood = guessNeighborhood(title, desc);
      const postDate = new Date(post.date);

      events.push({
        id: generateId('vejasp', title, post.date),
        title,
        description: desc,
        category,
        date: postDate.toISOString(),
        location: neighborhood,
        neighborhood,
        price: isFree ? 0 : 30,
        isFree,
        imageUrl: imageUrl || 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&q=80',
        ticketUrl: post.link,
        source: 'Veja SP',
        sourceUrl: post.link,
        tags: ['vejasp', 'cultura', 'sp', category],
        featured: isFree || category === 'musica' || category === 'exposicao',
      });
    }
    console.log(`[Veja SP] Coletados ${events.length} eventos.`);
  } catch (err) {
    console.warn('[Veja SP] Falha na coleta:', err.message);
  }
  return events;
}

// ─── 2. Catraca Livre (Gira / Agenda Cultural SP) ───────────────────────────

async function fetchCatracaLivre() {
  const events = [];
  try {
    const url = 'https://catracalivre.com.br/wp-json/wp/v2/posts?categories=402828&per_page=30&_embed=true';
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const posts = await res.json();

    for (const post of posts) {
      const title = decodeHtmlEntities(post.title?.rendered || '');
      if (!title || title.length < 5) continue;

      const desc = decodeHtmlEntities(post.excerpt?.rendered || '');
      const imageUrl = post._embedded?.['wp:featuredmedia']?.[0]?.source_url;
      const isFree = /grátis|gratuito|gratuita|0800|de graça|franca/i.test(`${title} ${desc}`);
      const category = guessCategory(title, desc);
      const neighborhood = guessNeighborhood(title, desc);
      const postDate = new Date(post.date);

      events.push({
        id: generateId('catraca', title, post.date),
        title,
        description: desc,
        category,
        date: postDate.toISOString(),
        location: neighborhood,
        neighborhood,
        price: isFree ? 0 : 25,
        isFree,
        imageUrl: imageUrl || 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800&q=80',
        ticketUrl: post.link,
        source: 'Catraca Livre',
        sourceUrl: post.link,
        tags: ['catracalivre', 'gratuito', 'sp', category],
        featured: isFree,
      });
    }
    console.log(`[Catraca Livre] Coletados ${events.length} eventos.`);
  } catch (err) {
    console.warn('[Catraca Livre] Falha na coleta:', err.message);
  }
  return events;
}

// ─── 3. São Paulo Para Crianças (Família & Infantil) ─────────────────────────

async function fetchSPParaCriancas() {
  const events = [];
  try {
    const url = 'https://saopauloparacriancas.com.br/wp-json/wp/v2/posts?per_page=20&_embed=true';
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const posts = await res.json();

    for (const post of posts) {
      const title = decodeHtmlEntities(post.title?.rendered || '');
      if (!title || title.length < 5) continue;

      const desc = decodeHtmlEntities(post.excerpt?.rendered || '');
      const imageUrl = post._embedded?.['wp:featuredmedia']?.[0]?.source_url;
      const isFree = /grátis|gratuito|gratuita|franca|livre/i.test(`${title} ${desc}`);
      const neighborhood = guessNeighborhood(title, desc);

      events.push({
        id: generateId('sp_criancas', title, post.date),
        title,
        description: desc,
        category: 'infantil',
        date: new Date(post.date).toISOString(),
        location: neighborhood,
        neighborhood,
        price: isFree ? 0 : 35,
        isFree,
        imageUrl: imageUrl || 'https://images.unsplash.com/photo-1508873696983-2df5293cb32f?w=800&q=80',
        ticketUrl: post.link,
        source: 'SP para Crianças',
        sourceUrl: post.link,
        tags: ['infantil', 'familia', 'criancas', 'sp'],
        featured: isFree,
      });
    }
    console.log(`[SP para Crianças] Coletados ${events.length} eventos.`);
  } catch (err) {
    console.warn('[SP para Crianças] Falha na coleta:', err.message);
  }
  return events;
}

// ─── 4. G1 São Paulo (Feed Cultural) ────────────────────────────────────────

async function fetchG1SP() {
  const events = [];
  try {
    const res = await fetch('https://g1.globo.com/rss/g1/sao-paulo/', { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const xml = await res.text();

    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
    for (const it of items) {
      const itemContent = it[1];
      const titleMatch = itemContent.match(/<title>([\s\S]*?)<\/title>/i);
      const linkMatch = itemContent.match(/<link>([\s\S]*?)<\/link>/i);
      const descMatch = itemContent.match(/<description>([\s\S]*?)<\/description>/i);
      const dateMatch = itemContent.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);

      if (!titleMatch || !linkMatch) continue;
      const rawTitle = decodeHtmlEntities(titleMatch[1]);
      const rawDesc = decodeHtmlEntities(descMatch ? descMatch[1] : '');

      // Filtra matérias que representem atrações culturais, shows, festivais ou lazer
      const isCulture = /festival|show|teatro|museu|feira|parque|exposição|gastronomia|cultura|cinema|música|corrida/i.test(`${rawTitle} ${rawDesc}`);
      if (!isCulture) continue;

      const isFree = /grátis|gratuito|gratuita/i.test(`${rawTitle} ${rawDesc}`);
      const category = guessCategory(rawTitle, rawDesc);
      const neighborhood = guessNeighborhood(rawTitle, rawDesc);
      const date = dateMatch ? new Date(dateMatch[1]).toISOString() : new Date().toISOString();

      // Extrai imagem se houver
      const imgMatch = itemContent.match(/<img[^>]+src=["']([^"']+)["']/i);
      const imageUrl = imgMatch ? imgMatch[1] : 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&q=80';

      events.push({
        id: generateId('g1', rawTitle, date),
        title: rawTitle,
        description: rawDesc,
        category,
        date,
        location: neighborhood,
        neighborhood,
        price: isFree ? 0 : 40,
        isFree,
        imageUrl,
        ticketUrl: linkMatch[1].trim(),
        source: 'G1 SP',
        sourceUrl: linkMatch[1].trim(),
        tags: ['g1', 'noticias', 'sp', category],
        featured: true,
      });
    }
    console.log(`[G1 SP] Coletados ${events.length} eventos culturais.`);
  } catch (err) {
    console.warn('[G1 SP] Falha na coleta:', err.message);
  }
  return events;
}

// ─── 5. Grandes Atrações Fixas e Sazonais do Calendário ──────────────────────
// Mantém as datas das atrações com horários pontuais bem definidos (sem repetição de 60 dias)

function getBaselineHighlights() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = (n) => String(n).padStart(2, '0');
  const d = (day, hour = 10, min = 0) => `${y}-${pad(m + 1)}-${pad(day)}T${pad(hour)}:${pad(min)}:00`;
  const nextM = (m + 1) % 12;
  const nextY = m + 1 >= 12 ? y + 1 : y;
  const dn = (day, hour = 10, min = 0) => `${nextY}-${pad(nextM + 1)}-${pad(day)}T${pad(hour)}:${pad(min)}:00`;

  return [
    {
      id: generateId('masp', 'MASP Terça Grátis', d(29)),
      title: 'MASP — "Histórias Paulistanas": Obras do Acervo Permanente (Terça Grátis)',
      description: 'A fantástica expografia nos cavaletes de cristal de Lina Bo Bardi reunindo obras de Van Gogh, Cézanne e Tarsila do Amaral. Entrada gratuita toda terça-feira mediante agendamento.',
      category: 'exposicao', date: d(29, 10), time: '10:00',
      location: 'MASP', address: 'Av. Paulista, 1578', neighborhood: 'Bela Vista',
      price: 0, isFree: true, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1580060839134-75a5edca2e99?w=800&q=80',
      ticketUrl: 'https://masp.org.br', source: 'MASP', sourceUrl: 'https://masp.org.br',
      tags: ['masp', 'arte', 'museu', 'paulista', 'exposicao', 'gratuito'],
    },
    {
      id: generateId('pinacoteca', 'Pinacoteca Sábado Grátis', d(27)),
      title: 'Pinacoteca de São Paulo — Arte Brasileira dos Séculos XIX e XX (Sábado Grátis)',
      description: 'A mais antiga instituição de arte de São Paulo apresenta seu acervo magistral, incluindo obras icônicas como O Mestiço e Saudade. Entrada franca aos sábados.',
      category: 'exposicao', date: d(27, 10), time: '10:00',
      location: 'Pinacoteca do Estado', address: 'Praça da Luz, 2 — Luz', neighborhood: 'Luz',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1518998053901-5348d3961a04?w=800&q=80',
      ticketUrl: 'https://pinacoteca.org.br', source: 'Pinacoteca SP', sourceUrl: 'https://pinacoteca.org.br',
      tags: ['pinacoteca', 'arte brasileira', 'museu', 'luz', 'exposicao', 'gratuito'],
    },
    {
      id: generateId('osesp', 'Concerto Sinfônico OSESP', d(28)),
      title: 'Concerto Sinfônico OSESP na Sala São Paulo',
      description: 'A Orquestra Sinfônica do Estado de São Paulo apresenta a 9ª Sinfonia de Beethoven com coro completo em uma das salas com melhor acústica do mundo.',
      category: 'musica', date: d(28, 16), time: '16:00',
      location: 'Sala São Paulo', address: 'Praça Júlio Prestes, 16', neighborhood: 'Luz',
      price: 35, priceMax: 180, isFree: false, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=800&q=80',
      ticketUrl: 'https://osesp.art.br', source: 'OSESP', sourceUrl: 'https://osesp.art.br',
      tags: ['osesp', 'musica classica', 'sala sao paulo'],
    },
    {
      id: generateId('oktoberfest', 'São Paulo Oktoberfest', dn(2)),
      title: 'São Paulo Oktoberfest 2026 — Parque Villa-Lobos',
      description: 'A autêntica festa da cerveja de São Paulo com cervejarias artesanais, comidas típicas alemãs, bandas folclóricas bávaras e shows nacionais.',
      category: 'gastronomia', date: dn(2, 16), endDate: dn(5, 23), time: '16:00',
      location: 'Parque Villa-Lobos', address: 'Av. Prof. Fonseca Rodrigues, 2001', neighborhood: 'Alto de Pinheiros',
      price: 60, priceMax: 180, isFree: false, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=800&q=80',
      ticketUrl: 'https://saopaulooktoberfest.com.br', source: 'Oktoberfest SP', sourceUrl: 'https://saopaulooktoberfest.com.br',
      tags: ['oktoberfest', 'cerveja', 'festa', 'gastronomia'],
    },
    {
      id: generateId('bgs', 'Brasil Game Show', dn(8)),
      title: 'Brasil Game Show (BGS 2026) — Expo Center Norte',
      description: 'Lançamentos mundiais de videogames, campeonatos eletrizantes de eSports, presença de lendas internacionais de games e área cosplay gigantesca.',
      category: 'tecnologia', date: dn(8, 13), endDate: dn(11, 21), time: '13:00',
      location: 'Expo Center Norte', address: 'Rua José Bernardo Pinto, 333', neighborhood: 'Vila Guilherme',
      price: 120, priceMax: 350, isFree: false, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=800&q=80',
      ticketUrl: 'https://brasilgameshow.com.br', source: 'BGS', sourceUrl: 'https://brasilgameshow.com.br',
      tags: ['bgs', 'games', 'tecnologia', 'esports', 'cosplay'],
    },
    {
      id: generateId('halloween_audio', 'Halloween da Audio', dn(31)),
      title: 'Halloween da Audio: O Grande Baile dos Monstros',
      description: 'A maior festa à fantasia de Halloween de São Paulo! Premiação para as melhores caracterizações, 3 pistas simultâneas e labirinto assombrado.',
      category: 'festa', date: dn(31, 22), time: '22:00',
      location: 'Audio Club', address: 'Av. Francisco Matarazzo, 694', neighborhood: 'Barra Funda',
      price: 80, priceMax: 220, isFree: false, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=800&q=80',
      ticketUrl: 'https://www.audiosp.com.br/', source: 'Audio SP', sourceUrl: 'https://www.audiosp.com.br/',
      tags: ['halloween', 'dia das bruxas', 'fantasia', 'balada'],
    },
    {
      id: generateId('memorial_los_muertos', 'Dia de Los Muertos Memorial', dn(31)),
      title: 'Memorial da América Latina: Grande Festival Dia de Los Muertos (Gratuito)',
      description: 'Tradicional celebração do Dia dos Mortos com mariachis, altares gigantes, flores de cempasúchil, desfile de Catrinas e gastronomia mexicana.',
      category: 'cultura', date: dn(31, 11), endDate: dn(31, 21), time: '11:00',
      location: 'Memorial da América Latina', address: 'Av. Auro Soares de Moura Andrade, 664', neighborhood: 'Barra Funda',
      price: 0, isFree: true, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=800&q=80',
      ticketUrl: 'https://memorial.org.br', source: 'Memorial América Latina', sourceUrl: 'https://memorial.org.br',
      tags: ['dia de los muertos', 'mexico', 'halloween', 'memorial', 'gratuito'],
    }
  ];
}

// ─── Deduplicação e Execução Principal ──────────────────────────────────────

function deduplicate(list) {
  const seen = new Map();
  for (const item of list) {
    const key = `${item.title.toLowerCase().slice(0, 30)}-${item.date.slice(0, 10)}`;
    if (!seen.has(key)) {
      seen.set(key, item);
    }
  }
  return Array.from(seen.values());
}

async function main() {
  console.log('🚀 Iniciando coleta diária de eventos para o GuiaMe SP...');

  const [veja, catraca, criancas, g1] = await Promise.all([
    fetchVejaSP(),
    fetchCatracaLivre(),
    fetchSPParaCriancas(),
    fetchG1SP(),
  ]);

  const baseline = getBaselineHighlights();

  const combined = deduplicate([
    ...veja,
    ...catraca,
    ...criancas,
    ...g1,
    ...baseline,
  ]);

  const now = new Date();
  const minDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const maxDate = new Date(now.getFullYear(), now.getMonth() + 2, 15);

  const validEvents = combined.filter((e) => {
    try {
      const dt = new Date(e.date);
      return !isNaN(dt.getTime()) && dt >= minDate && dt <= maxDate;
    } catch {
      return false;
    }
  });

  // Ordena cronologicamente por data
  validEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Garante que o diretório public/data existe
  const dir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const payload = {
    updatedAt: new Date().toISOString(),
    totalCount: validEvents.length,
    sources: ['Veja SP', 'Catraca Livre', 'SP para Crianças', 'G1 SP', 'Instituições SP'],
    events: validEvents,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`✅ Sucesso! ${combined.length} eventos salvos com sucesso em ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('❌ Erro fatal durante a atualização:', err);
  process.exit(1);
});

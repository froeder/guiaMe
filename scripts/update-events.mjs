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

const PT_MONTHS = {
  janeiro: 0, jan: 0,
  fevereiro: 1, fev: 1,
  março: 2, marco: 2, mar: 2,
  abril: 3, abr: 3,
  maio: 4, mai: 4,
  junho: 5, jun: 5,
  julho: 6, jul: 6,
  agosto: 7, ago: 7,
  setembro: 8, set: 8,
  outubro: 9, out: 9,
  novembro: 10, nov: 10,
  dezembro: 11, dez: 11,
};

function extractEventDate(title, description, fallbackDateStr) {
  const text = `${title} ${description || ''}`.toLowerCase();

  // Ignora menção a ruas/estações como '25 de março'
  const sanitizedText = text
    .replace(/(?:rua|av\.?|avenida|ladeira|alameda|estação|shopping|galeria|mercado)\s+25\s+de\s+março/gi, 'rua vinte e cinco de março')
    .replace(/à\s+25\s+de\s+março/gi, 'ao centro comercial');

  const pad = (n) => String(n).padStart(2, '0');

  // 1. Procura datas explícitas como "de 10 a 15 de outubro", "12 de outubro", "no dia 12 de outubro"
  const dateMatch = sanitizedText.match(/(?:dia|de|a partir de|até|ate|em)\s+(\d{1,2})(?:\s+(?:a|e|ao|até)\s+\d{1,2})?\s+de\s+(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+(\d{4}))?/i)
    || sanitizedText.match(/(\d{1,2})\s+de\s+(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+(\d{4}))?/i);

  if (dateMatch) {
    const day = parseInt(dateMatch[1], 10);
    const month = PT_MONTHS[dateMatch[2].toLowerCase()];
    const year = dateMatch[3] ? parseInt(dateMatch[3], 10) : new Date().getFullYear();
    if (day >= 1 && day <= 31 && month !== undefined) {
      return `${year}-${pad(month + 1)}-${pad(day)}T10:00:00`;
    }
  }

  // 2. Procura menção geral a outubro
  if (/em\s+outubro|durante\s+(?:o\s+mês\s+de\s+)?outubro|especial\s+de\s+outubro|programação\s+de\s+outubro|mês\s+das\s+crianças/i.test(sanitizedText)) {
    const y = new Date().getFullYear();
    return `${y}-10-10T14:00:00`;
  }

  // 3. Menção explícita a Halloween ou Dia das Bruxas sem dia numérico
  if (/halloween|dia\s+das\s+bruxas/i.test(sanitizedText)) {
    const y = new Date().getFullYear();
    return `${y}-10-31T19:00:00`;
  }

  // 4. Menção explícita a Dia das Crianças
  if (/dia\s+das\s+crianças|semana\s+da\s+criança/i.test(sanitizedText)) {
    const y = new Date().getFullYear();
    return `${y}-10-12T10:00:00`;
  }

  try {
    const dt = new Date(fallbackDateStr);
    return !isNaN(dt.getTime()) ? dt.toISOString() : new Date().toISOString();
  } catch {
    return new Date().toISOString();
  }
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
      const eventDateStr = extractEventDate(title, desc, post.date);

      events.push({
        id: generateId('vejasp', title, eventDateStr),
        title,
        description: desc,
        category,
        date: eventDateStr,
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
      const eventDateStr = extractEventDate(title, desc, post.date);

      events.push({
        id: generateId('catraca', title, eventDateStr),
        title,
        description: desc,
        category,
        date: eventDateStr,
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
      const eventDateStr = extractEventDate(title, desc, post.date);

      events.push({
        id: generateId('sp_criancas', title, eventDateStr),
        title,
        description: desc,
        category: 'infantil',
        date: eventDateStr,
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
      const rawDate = dateMatch ? dateMatch[1] : new Date().toISOString();
      const eventDateStr = extractEventDate(rawTitle, rawDesc, rawDate);

      // Extrai imagem se houver
      const imgMatch = itemContent.match(/<img[^>]+src=["']([^"']+)["']/i);
      const imageUrl = imgMatch ? imgMatch[1] : 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&q=80';

      events.push({
        id: generateId('g1', rawTitle, eventDateStr),
        title: rawTitle,
        description: rawDesc,
        category,
        date: eventDateStr,
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
  const pad = (n) => String(n).padStart(2, '0');
  const oct = (day, hour = 10, min = 0) => `${y}-10-${pad(day)}T${pad(hour)}:${pad(min)}:00`;
  const sep = (day, hour = 10, min = 0) => `${y}-09-${pad(day)}T${pad(hour)}:${pad(min)}:00`;

  return [
    // ══════════════════════════════════════════════════════════════════════════
    // 🎃 ESPECIAL DIA DAS BRUXAS / HALLOWEEN & DIA DO SACI (31 DE OUTUBRO) 🎃
    // ══════════════════════════════════════════════════════════════════════════
    {
      id: generateId('audio', 'Halloween da Audio', oct(31, 22)),
      title: 'Halloween da Audio: O Grande Baile dos Monstros',
      description: 'A maior festa à fantasia de Halloween de São Paulo! Concurso com premiação de R$ 10.000 para as melhores caracterizações, 3 pistas simultâneas (Rock, Pop, Eletrônico), labirinto assombrado com atores e open bar temático no mezanino.',
      category: 'festa', date: oct(31, 22), time: '22:00',
      location: 'Audio Club', address: 'Av. Francisco Matarazzo, 694 — Barra Funda', neighborhood: 'Barra Funda',
      price: 80, priceMax: 220, isFree: false, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=800&q=80',
      ticketUrl: 'https://www.audiosp.com.br/', source: 'Audio SP', sourceUrl: 'https://www.audiosp.com.br/',
      tags: ['halloween', 'dia das bruxas', 'fantasia', 'balada', 'audio', 'barra funda'],
    },
    {
      id: generateId('madame', 'Madame Underground Club Halloween', oct(31, 23)),
      title: 'Madame Underground Club: A Lendária Noite de Halloween Gótica',
      description: 'O clube gótico mais lendário da América Latina celebra a Noite de Halloween no casarão histórico da Bela Vista. Decoração fúnebre exclusiva, poções no bar, DJs de post-punk, darkwave e gothic rock, e concurso de fantasias dark.',
      category: 'festa', date: oct(31, 23), time: '23:00',
      location: 'Madame Underground Club', address: 'Rua Conselheiro Ramalho, 873 — Bela Vista', neighborhood: 'Bela Vista',
      price: 45, priceMax: 90, isFree: false, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&q=80',
      ticketUrl: 'https://madameclub.com.br', source: 'Madame Club', sourceUrl: 'https://madameclub.com.br',
      tags: ['halloween', 'dia das bruxas', 'madame', 'goth', 'bela vista', 'festa'],
    },
    {
      id: generateId('candlelight', 'Candlelight Halloween Trilhas Sonoras', oct(31, 19, 30)),
      title: 'Candlelight Halloween: Trilhas Sonoras de Terror à Luz de Velas',
      description: 'Concerto à luz de velas intimista com quarteto de cordas executando trilhas inesquecíveis: Halloween (John Carpenter), O Exorcista, Tubarão, Stranger Things, Psicose, Danse Macabre e Thriller sob a luz de 5.000 velas.',
      category: 'musica', date: oct(31, 19, 30), time: '19:30',
      location: 'Teatro Bradesco', address: 'Rua Palestra Itália, 500 — Bourbon Shopping', neighborhood: 'Perdizes',
      price: 75, priceMax: 190, isFree: false, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1507676184212-d03ab07a01bf?w=800&q=80',
      ticketUrl: 'https://feverup.com/sao-paulo', source: 'Candlelight', sourceUrl: 'https://feverup.com/sao-paulo',
      tags: ['halloween', 'candlelight', 'concerto', 'trilhas sonoras', 'terror', 'musica'],
    },
    {
      id: generateId('mis', 'MIS SP Maratona Cine Horror', oct(31, 19)),
      title: 'MIS SP: Maratona Cine Horror Especial Madrugada de Halloween',
      description: 'Noite inteira com clássicos do terror nas salas do Museu da Imagem e do Som. Exibição de O Iluminado, Suspiria e A Bruxa em cópias restauradas, lounge com DJs tocando synth horror, food trucks e concurso de cosplay macabro.',
      category: 'cinema', date: oct(31, 19), endDate: oct(31, 23, 59), time: '19:00',
      location: 'MIS - Museu da Imagem e do Som', address: 'Av. Europa, 158', neighborhood: 'Jardim Europa',
      price: 20, priceMax: 40, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=800&q=80',
      ticketUrl: 'https://www.mis-sp.org.br/', source: 'MIS SP', sourceUrl: 'https://www.mis-sp.org.br/',
      tags: ['halloween', 'cinema', 'filmes de terror', 'cine horror', 'mis', 'dia das bruxas'],
    },
    {
      id: generateId('villalobos_halloween', 'Parque Villa-Lobos Halloween Pet', oct(31, 10)),
      title: 'Parque Villa-Lobos: Caça aos Doces ou Travessuras & Halloween Pet (Gratuito)',
      description: 'Grande celebração diurna de Dia das Bruxas para famílias, crianças e seus pets! Trilha do "Doces ou Travessuras", pintura facial de monstrinhos, concurso de fantasias infantil e de pets, contação de causos assustadores e oficinas de artesanato. Grátis.',
      category: 'infantil', date: oct(31, 10), endDate: oct(31, 17), time: '10:00',
      location: 'Parque Villa-Lobos', address: 'Av. Prof. Fonseca Rodrigues, 2001', neighborhood: 'Alto de Pinheiros',
      price: 0, isFree: true, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1508873696983-2df5293cb32f?w=800&q=80',
      ticketUrl: 'https://parquevillalobos.sp.gov.br', source: 'Parques SP', sourceUrl: 'https://parquevillalobos.sp.gov.br',
      tags: ['halloween', 'infantil', 'dia das bruxas', 'doces ou travessuras', 'pet', 'gratuito'],
    },
    {
      id: generateId('sesc_saci', 'SESC Pompeia Dia do Saci', oct(31, 15)),
      title: 'SESC Pompeia: Dia do Saci & Lendas Urbanas de São Paulo (Gratuito)',
      description: '31 de outubro também é o oficial Dia do Saci no Brasil! O SESC Pompeia celebra com contação teatral das lendas urbanas paulistanas (A Loira do Banheiro, O Fantasma do Municipal e o Castelo da Rua Apa), cortejo musical e oficina de fantoches de seres mágicos.',
      category: 'cultura', date: oct(31, 15), endDate: oct(31, 19), time: '15:00',
      location: 'SESC Pompeia', address: 'Rua Clélia, 93', neighborhood: 'Pompeia',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1514533450685-4493e01d1fdc?w=800&q=80',
      ticketUrl: 'https://www.sescsp.org.br/agenda/', source: 'SESC SP', sourceUrl: 'https://www.sescsp.org.br/agenda/',
      tags: ['dia do saci', 'halloween', 'folclore', 'lendas urbanas', 'sesc', 'gratuito'],
    },
    {
      id: generateId('zombie_walk', 'Zombie Walk São Paulo Centro', oct(31, 14)),
      title: 'Zombie Walk São Paulo: Marcha dos Mortos-Vivos no Centro Histórico (Gratuito)',
      description: 'Tradicional concentração anual onde milhares de paulistanos fantasiados e maquiados de zumbis caminham pelas ruas do centro velho de SP. Maquiadores voluntários, flash mobs com coreografia de "Thriller", cortejo musical e arrecadação de alimentos.',
      category: 'cultura', date: oct(31, 14), endDate: oct(31, 18), time: '14:00',
      location: 'Praça do Patriarca & Viaduto do Chá', address: 'Praça do Patriarca, s/n', neighborhood: 'Centro Histórico',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=800&q=80',
      ticketUrl: 'https://www.prefeitura.sp.gov.br', source: 'Prefeitura SP', sourceUrl: 'https://www.prefeitura.sp.gov.br',
      tags: ['halloween', 'zombie walk', 'zumbi', 'centro historico', 'dia das bruxas', 'gratuito'],
    },
    {
      id: generateId('tokyo_halloween', 'Tokyo Rooftop Halloween', oct(31, 20)),
      title: 'Tokyo República: Halloween nas Alturas — Rooftop & Karaokê do Terror',
      description: '9 andares de festa na República: karaokês privativos decorados com clássicos cult de horror, pista no terraço com vista para o Copan iluminado de roxo e abóbora, carta de coquetéis com seringas e névoa cenográfica, e sets de indie, dark pop e disco.',
      category: 'festa', date: oct(31, 20), time: '20:00',
      location: 'Tokyo Rooftop', address: 'Rua Major Sertório, 110 — República', neighborhood: 'República',
      price: 50, priceMax: 90, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=800&q=80',
      ticketUrl: 'https://tokyo011.com.br', source: 'Tokyo SP', sourceUrl: 'https://tokyo011.com.br',
      tags: ['halloween', 'balada', 'rooftop', 'tokyo', 'republica', 'karaoke'],
    },
    {
      id: generateId('cine_joia_halloween', 'Cine Joia Freak Show Party', oct(31, 22, 30)),
      title: 'Cine Joia: Freak Show Halloween Circus Party',
      description: 'O templo da música na Liberdade se transforma em um bizarro circo dos horrores! Projeção mapeada imersiva 360°, trupe circense burlesca, maquiadores no local e line-up com DJs de electropop, funk e tribal. Premiação para as melhores fantasias.',
      category: 'festa', date: oct(31, 22, 30), time: '22:30',
      location: 'Cine Joia', address: 'Praça Carlos Gomes, 82 — Liberdade', neighborhood: 'Liberdade',
      price: 55, priceMax: 110, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800&q=80',
      ticketUrl: 'https://cinejoia.tv', source: 'Cine Joia', sourceUrl: 'https://cinejoia.tv',
      tags: ['halloween', 'cine joia', 'liberdade', 'freak show', 'balada', 'fantasia'],
    },
    {
      id: generateId('pubcrawl_halloween', 'Vila Madalena Halloween Pub Crawl', oct(31, 18)),
      title: 'Vila Madalena Halloween Pub Crawl & Rota dos Bares Assombrados',
      description: 'O circuito etílico mais divertido de São Paulo: passagem guiada por 5 bares temáticos da Vila Madalena, com direito a welcome shots de "poção mágica", petiscos temáticos monstruosos, concurso de fantasias e entrada VIP para a balada de encerramento.',
      category: 'gastronomia', date: oct(31, 18), time: '18:00',
      location: 'Vila Madalena', address: 'Rua Aspicuelta, 300 (Concentração)', neighborhood: 'Vila Madalena',
      price: 65, priceMax: 120, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=800&q=80',
      ticketUrl: 'https://sympla.com.br', source: 'Sympla', sourceUrl: 'https://sympla.com.br',
      tags: ['halloween', 'pub crawl', 'vila madalena', 'gastronomia', 'drinks', 'dia das bruxas'],
    },
    {
      id: generateId('ccsp_literatura_macabra', 'CCSP Mostra Literaria Macabra', oct(31, 17)),
      title: 'CCSP: Mostra Literária Macabra — Sarau das Bruxas e Literatura Gótica (Gratuito)',
      description: 'Tarde e noite dedicada aos clássicos da literatura gótica e fantástica no Centro Cultural SP. Leitura dramática ao vivo de contos de Mary Shelley, Edgar Allan Poe e Lygia Fagundes Telles, sarau poético aberto, feira de zines independentes e debates.',
      category: 'literatura', date: oct(31, 17), endDate: oct(31, 21), time: '17:00',
      location: 'Centro Cultural São Paulo', address: 'R. Vergueiro, 1000 — Paraíso', neighborhood: 'Paraíso',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1455849318743-b2233052fcff?w=800&q=80',
      ticketUrl: 'https://centrocultural.sp.gov.br', source: 'Centro Cultural SP', sourceUrl: 'https://centrocultural.sp.gov.br',
      tags: ['halloween', 'literatura', 'sarau', 'bruxas', 'ccsp', 'gratuito'],
    },
    {
      id: generateId('martinelli_halloween', 'Edificio Martinelli Baile Mascaras', oct(31, 21)),
      title: 'Edifício Martinelli: Baile de Máscaras & Halloween no Terraço Histórico',
      description: 'No topo do primeiro arranha-céu da cidade, uma festa glamorosa e exclusiva de Halloween. Vista de 360 graus do skyline paulistano, orquestra jazzística de câmara tocando temas de mistério, open bar premium e alta gastronomia.',
      category: 'festa', date: oct(31, 21), time: '21:00',
      location: 'Edifício Martinelli', address: 'Rua São Bento, 405 — Centro', neighborhood: 'Centro Histórico',
      price: 190, priceMax: 380, isFree: false, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=800&q=80',
      ticketUrl: 'https://edificiomartinelli.com.br', source: 'Martinelli', sourceUrl: 'https://edificiomartinelli.com.br',
      tags: ['halloween', 'edificio martinelli', 'baile de mascaras', 'centro', 'destaque'],
    },
    {
      id: generateId('escape60_halloween', 'Escape 60 Noite de Horror Extremo', oct(31, 15)),
      title: 'Escape 60: Noite de Horror Extremo com Atores Vivos — Especial Halloween',
      description: 'Para quem tem coragem de verdade: salas de fuga temáticas com atores profissionais caracterizados como monstros, zumbis e criaturas paranormais interagindo em tempo real. 60 minutos de enigmas e adrenalina pura!',
      category: 'outros', date: oct(31, 15), endDate: oct(31, 23), time: '15:00',
      location: 'Escape 60 Jardins & Moema', address: 'Al. dos Anapurus, 1479 — Moema', neighborhood: 'Moema',
      price: 119, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&q=80',
      ticketUrl: 'https://escape60.com.br', source: 'Escape 60', sourceUrl: 'https://escape60.com.br',
      tags: ['halloween', 'escape room', 'jogos', 'terror', 'moema'],
    },
    {
      id: generateId('liberdade_geek_halloween', 'Praca Liberdade Feira Geek Halloween', oct(31, 16)),
      title: 'Praça da Liberdade: Feira Noturna Geek, Cosplay & Mística de Halloween (Gratuito)',
      description: 'Feira especial de Dia das Bruxas com mais de 70 barraquinhas: quitutes orientais com temática monstruosa (crepes negros, taiyakis recheados de poção vermelha), tendas de leitura de tarô, concurso de cosplay sobrenatural e flash tattoos.',
      category: 'cultura', date: oct(31, 16), endDate: oct(31, 22), time: '16:00',
      location: 'Praça da Liberdade', address: 'Praça da Liberdade, s/n', neighborhood: 'Liberdade',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1569050467447-ce54b3bbc37d?w=800&q=80',
      ticketUrl: 'https://www.cidadedesaopaulo.com', source: 'SP Turismo', sourceUrl: 'https://www.cidadedesaopaulo.com',
      tags: ['halloween', 'liberdade', 'geek', 'cosplay', 'feira noturna', 'gratuito'],
    },
    {
      id: generateId('cinemateca_macabra', 'Cinemateca Ciclo Cinema Macabro', oct(30, 19)),
      title: 'Cinemateca Brasileira: Ciclo Cinema Macabro e Clássicos de Horror (Gratuito)',
      description: 'Projeção ao ar livre nos jardins da Cinemateca com clássicos do terror mundial: Drácula de Bela Lugosi, Nosferatu com acompanhamento de piano ao vivo e O Bebê de Rosemary. Entrada gratuita com retirada de senha 1h antes.',
      category: 'cinema', date: oct(30, 19), endDate: oct(31, 22), time: '19:00',
      location: 'Cinemateca Brasileira', address: 'Largo Senador Raul Cardoso, 207', neighborhood: 'Vila Clementino',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=800&q=80',
      ticketUrl: 'https://cinemateca.org.br', source: 'Cinemateca', sourceUrl: 'https://cinemateca.org.br',
      tags: ['halloween', 'cinemateca', 'cinema de terror', 'gratuito', 'filmes'],
    },
    {
      id: generateId('hopi_hari_horrores', 'Hopi Hari Noite dos Horrores', oct(30, 17)),
      title: 'Hopi Hari: Noite dos Horrores Especial Pré-Halloween',
      description: 'O maior parque temático da região de SP com túneis assustadores, dezenas de atores caracterizados, shows musicais de abertura e montanhas-russas funcionando até altas horas da noite. Transporte especial saindo do Terminal Barra Funda.',
      category: 'outros', date: oct(30, 17), time: '17:00',
      location: 'Hopi Hari (Saída Barra Funda)', address: 'Terminal Rodoviário Barra Funda', neighborhood: 'Barra Funda',
      price: 139, priceMax: 219, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1513889961551-628c1e5e2ee9?w=800&q=80',
      ticketUrl: 'https://hopihari.com.br', source: 'Hopi Hari', sourceUrl: 'https://hopihari.com.br',
      tags: ['halloween', 'hopi hari', 'noite dos horrores', 'parque', 'adrenalina'],
    },
    {
      id: generateId('memorial_los_muertos', 'Dia de Los Muertos Memorial', oct(31, 11)),
      title: 'Memorial da América Latina: Grande Festival Dia de Los Muertos (Gratuito)',
      description: 'Tradicional celebração do Dia dos Mortos com mariachis, altares gigantes, flores de cempasúchil, desfile de Catrinas e gastronomia mexicana.',
      category: 'cultura', date: oct(31, 11), endDate: oct(31, 21), time: '11:00',
      location: 'Memorial da América Latina', address: 'Av. Auro Soares de Moura Andrade, 664', neighborhood: 'Barra Funda',
      price: 0, isFree: true, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=800&q=80',
      ticketUrl: 'https://memorial.org.br', source: 'Memorial América Latina', sourceUrl: 'https://memorial.org.br',
      tags: ['dia de los muertos', 'mexico', 'halloween', 'memorial', 'gratuito'],
    },

    // ══════════════════════════════════════════════════════════════════════════
    // 🍂 OUTUBRO — GRANDES EVENTOS DO MÊS INTEIRO 🍂
    // ══════════════════════════════════════════════════════════════════════════
    {
      id: generateId('oktoberfest', 'São Paulo Oktoberfest', oct(2, 16)),
      title: 'São Paulo Oktoberfest 2026 — Parque Villa-Lobos',
      description: 'A autêntica festa da cerveja de São Paulo com cervejarias artesanais, comidas típicas alemãs, bandas folclóricas bávaras e shows nacionais.',
      category: 'gastronomia', date: oct(2, 16), endDate: oct(5, 23), time: '16:00',
      location: 'Parque Villa-Lobos', address: 'Av. Prof. Fonseca Rodrigues, 2001', neighborhood: 'Alto de Pinheiros',
      price: 60, priceMax: 180, isFree: false, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=800&q=80',
      ticketUrl: 'https://saopaulooktoberfest.com.br', source: 'Oktoberfest SP', sourceUrl: 'https://saopaulooktoberfest.com.br',
      tags: ['oktoberfest', 'cerveja', 'festa', 'gastronomia'],
    },
    {
      id: generateId('jorge_ben_jor', 'Show Jorge Ben Jor Espaco Unimed', oct(3, 21)),
      title: 'Show: Jorge Ben Jor & Banda Zé Pretinho — Espaço Unimed',
      description: 'O mestre do samba-rock e da música brasileira em um show épico com todos os hinos atemporais: Taj Mahal, Mas Que Nada, Chove Chuva, País Tropical e Fio Maravilha. Pista e camarotes disponíveis.',
      category: 'musica', date: oct(3, 21), time: '21:00',
      location: 'Espaço Unimed', address: 'R. Tagipuru, 795 — Barra Funda', neighborhood: 'Barra Funda',
      price: 110, priceMax: 320, isFree: false, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&q=80',
      ticketUrl: 'https://espacounimed.com.br', source: 'Espaço Unimed', sourceUrl: 'https://espacounimed.com.br',
      tags: ['jorge ben jor', 'musica', 'show', 'samba rock', 'barra funda'],
    },
    {
      id: generateId('jardim_botanico_primavera', 'Festival Primavera Jardim Botanico', oct(4, 9)),
      title: 'Festival de Primavera no Jardim Botânico (Gratuito)',
      description: 'Exposição botânica com mais de 500 orquídeas e bromélias raras, feira de mudas, visitas guiadas pelas estufas históricas e caminhadas meditativas em meio à Mata Atlântica preservada da zona sul.',
      category: 'cultura', date: oct(4, 9), endDate: oct(4, 17), time: '09:00',
      location: 'Jardim Botânico de São Paulo', address: 'Av. Miguel Estefno, 3031', neighborhood: 'Água Funda',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=800&q=80',
      ticketUrl: 'https://jardimbotanico.sp.gov.br', source: 'Jardim Botânico', sourceUrl: 'https://jardimbotanico.sp.gov.br',
      tags: ['flores', 'jardim botanico', 'natureza', 'primavera', 'gratuito'],
    },
    {
      id: generateId('samba_bixiga', 'Roda de Samba Tradicional Bixiga', oct(7, 19)),
      title: 'Roda de Samba Tradicional do Bixiga na Rua 13 de Maio (Gratuito)',
      description: 'O autêntico samba de raiz do tradicional bairro do Bixiga: cavaquinho, pandeiro e surdo comandados pelos baluartes da Vai-Vai. Mesas na calçada, cerveja gelada e porções de pastel com queijo canastra.',
      category: 'musica', date: oct(7, 19), time: '19:00',
      location: 'Rua Treze de Maio (Bixiga)', address: 'Rua Treze de Maio, 800', neighborhood: 'Bela Vista',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800&q=80',
      ticketUrl: 'https://www.prefeitura.sp.gov.br', source: 'Prefeitura SP', sourceUrl: 'https://www.prefeitura.sp.gov.br',
      tags: ['samba', 'bixiga', 'musica', 'gratuito', 'roda de samba'],
    },
    {
      id: generateId('bgs', 'Brasil Game Show', oct(8, 13)),
      title: 'Brasil Game Show (BGS 2026) — Expo Center Norte',
      description: 'Lançamentos mundiais de videogames, campeonatos eletrizantes de eSports, presença de lendas internacionais de games e área cosplay gigantesca.',
      category: 'tecnologia', date: oct(8, 13), endDate: oct(11, 21), time: '13:00',
      location: 'Expo Center Norte', address: 'Rua José Bernardo Pinto, 333', neighborhood: 'Vila Guilherme',
      price: 120, priceMax: 350, isFree: false, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=800&q=80',
      ticketUrl: 'https://brasilgameshow.com.br', source: 'BGS', sourceUrl: 'https://brasilgameshow.com.br',
      tags: ['bgs', 'games', 'tecnologia', 'esports', 'cosplay'],
    },
    {
      id: generateId('jazzb_noite', 'Noite Jazz e Vinhos JazzB', oct(9, 21)),
      title: 'Noite de Jazz & Vinhos no JazzB — República',
      description: 'Uma noite intimista com o sexteto de jazz paulistano homenageando Miles Davis e John Coltrane. Carta especial de vinhos de pequenos produtores nacionais e tábua de queijos artesanais da serra da Mantiqueira.',
      category: 'musica', date: oct(9, 21), time: '21:00',
      location: 'JazzB', address: 'Rua General Jardim, 43 — Vila Buarque', neighborhood: 'República',
      price: 40, priceMax: 70, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?w=800&q=80',
      ticketUrl: 'https://jazzb.net', source: 'JazzB', sourceUrl: 'https://jazzb.net',
      tags: ['jazz', 'musica', 'jazzb', 'vinhos', 'republica'],
    },
    {
      id: generateId('circo_stankowich', 'Circo Stankowich Mes das Criancas', oct(10, 17)),
      title: 'Circo Stankowich — Especial Mês das Crianças',
      description: 'O mais antigo e consagrado circo tradicional do Brasil apresenta um super espetáculo com trapezistas voadores, o incrível Globo da Morte com 6 motos, águas dançantes e palhaços premiados mundialmente.',
      category: 'cultura', date: oct(10, 17), endDate: oct(12, 20), time: '17:00',
      location: 'Sambódromo do Anhembi', address: 'Av. Olavo Fontoura, 1209 — Santana', neighborhood: 'Santana',
      price: 40, priceMax: 120, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=800&q=80',
      ticketUrl: 'https://stankowich.com.br', source: 'Circo Stankowich', sourceUrl: 'https://stankowich.com.br',
      tags: ['circo', 'stankowich', 'infantil', 'familia', 'anhembi'],
    },
    {
      id: generateId('ibirapuera_criancas', 'Festival Criancas Ibirapuera', oct(11, 10)),
      title: 'Festival das Crianças no Parque Ibirapuera (Gratuito)',
      description: 'Especial Semana e Dia das Crianças (12/10)! Três palcos com espetáculos circenses, teatro de bonecos, contação de fábulas, shows de mágica e oficinas científicas. Piquenique aberto e atrações 100% gratuitas.',
      category: 'infantil', date: oct(11, 10), endDate: oct(12, 18), time: '10:00',
      location: 'Parque Ibirapuera — Praça da Paz', address: 'Av. Pedro Álvares Cabral, s/n', neighborhood: 'Vila Mariana',
      price: 0, isFree: true, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?w=800&q=80',
      ticketUrl: 'https://ibirapuera.org', source: 'Parque Ibirapuera', sourceUrl: 'https://ibirapuera.org',
      tags: ['dia das criancas', 'infantil', 'ibirapuera', 'circo', 'gratuito'],
    },
    {
      id: generateId('spfw', 'Sao Paulo Fashion Week Bienal', oct(14, 15)),
      title: 'São Paulo Fashion Week (SPFW) — Pavilhão da Bienal',
      description: 'A semana de moda mais prestigiada do hemisfério sul. Desfiles das maiores marcas e estilistas de vanguarda, exposições de fotografia têxtil, palestras sobre sustentabilidade e pop-up stores de designers independentes.',
      category: 'cultura', date: oct(14, 15), endDate: oct(18, 22), time: '15:00',
      location: 'Pavilhão da Bienal — Ibirapuera', address: 'Portão 3 — Parque Ibirapuera', neighborhood: 'Vila Mariana',
      price: 80, priceMax: 300, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80',
      ticketUrl: 'https://spfw.com.br', source: 'SPFW', sourceUrl: 'https://spfw.com.br',
      tags: ['spfw', 'moda', 'bienal', 'estilo', 'ibirapuera'],
    },
    {
      id: generateId('bolshoi_theatro_municipal', 'Bale Bolshoi Theatro Municipal', oct(16, 20)),
      title: 'Balé Bolshoi: Gala Clássica — Theatro Municipal de São Paulo',
      description: 'Solistas consagrados da Escola do Teatro Bolshoi executam trechos de O Quebra-Nozes, Don Quixote e Spartacus, acompanhados ao vivo pela Orquestra Sinfônica Municipal. Cenários suntuosos e técnica impecável.',
      category: 'danca', date: oct(16, 20), endDate: oct(17, 20), time: '20:00',
      location: 'Theatro Municipal de São Paulo', address: 'Praça Ramos de Azevedo, s/n', neighborhood: 'Centro Histórico',
      price: 50, priceMax: 240, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1518611507888-3e15cce98b21?w=800&q=80',
      ticketUrl: 'https://theatromunicipal.org.br', source: 'Theatro Municipal', sourceUrl: 'https://theatromunicipal.org.br',
      tags: ['bale', 'danca', 'theatro municipal', 'bolshoi', 'cultura'],
    },
    {
      id: generateId('festival_cafe_imigracao', 'Festival do Cafe Museu Imigracao', oct(17, 10)),
      title: 'Festival do Café e Sabores Paulistas — Museu da Imigração',
      description: 'Feira gastronômica com os melhores cafés especiais do estado de SP, baristas premiados ministrando workshops gratuitos, doces típicos da roça, queijos artesanais e apresentações musicais de choro e caipira nos jardins históricos.',
      category: 'gastronomia', date: oct(17, 10), endDate: oct(18, 18), time: '10:00',
      location: 'Museu da Imigração', address: 'Rua Visconde de Parnaíba, 1316 — Mooca', neighborhood: 'Mooca',
      price: 16, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1447933601403-0c6688de566e?w=800&q=80',
      ticketUrl: 'https://museudaimigracao.org.br', source: 'Museu da Imigração', sourceUrl: 'https://museudaimigracao.org.br',
      tags: ['cafe', 'gastronomia', 'mooca', 'museu da imigracao', 'feira'],
    },
    {
      id: generateId('hackathon_usp', 'Hackathon SP Tech InovaUSP', oct(17, 9)),
      title: 'Hackathon SP Tech — Inteligência Artificial no InovaUSP (Gratuito)',
      description: 'Maratona hacker de 48 horas focada no desenvolvimento de soluções de IA para saúde pública, mobilidade urbana e educação em SP. Mentoria com especialistas do Google, premiações e networking com investidores.',
      category: 'tecnologia', date: oct(17, 9), endDate: oct(18, 18), time: '09:00',
      location: 'InovaUSP — Cidade Universitária', address: 'Av. Prof. Lúcio Martins Rodrigues, 370', neighborhood: 'Butantã',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=800&q=80',
      ticketUrl: 'https://inova.usp.br', source: 'InovaUSP', sourceUrl: 'https://inova.usp.br',
      tags: ['hackathon', 'tecnologia', 'inteligencia artificial', 'usp', 'gratuito'],
    },
    {
      id: generateId('mostra_cinema_sp', '48 Mostra Internacional Cinema SP', oct(18, 14)),
      title: '48ª Mostra Internacional de Cinema de São Paulo',
      description: 'O festival cinematográfico mais relevante do país exibe mais de 300 filmes inéditos vindos de 60 países. Sessões no CineSesc, Espaço Itaú Augusta, IMS Paulista e projeções gratuitas no vão do MASP.',
      category: 'cinema', date: oct(18, 14), endDate: oct(31, 23), time: '14:00',
      location: 'Circuito de Cinemas de SP', address: 'Diversas salas (CineSesc, CCSP, Reserva)', neighborhood: 'Consolação e Centro',
      price: 24, priceMax: 48, isFree: false, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=800&q=80',
      ticketUrl: 'https://mostra.org', source: 'Mostra SP', sourceUrl: 'https://mostra.org',
      tags: ['mostra sp', 'cinema', 'filmes', 'cinesesc', 'festival de cinema'],
    },
    {
      id: generateId('expo_aviacao', 'Expo Aviacao Campo de Marte', oct(19, 9)),
      title: 'Expo Aviação & Simuladores — Aeroporto Campo de Marte',
      description: 'Aeronaves clássicas da aviação civil e militar abertas para visitação interna, simuladores de caça e Boeing 737, além de voos panorâmicos de helicóptero sobre a capital paulista.',
      category: 'aviacao', date: oct(19, 9), endDate: oct(20, 18), time: '09:00',
      location: 'Campo de Marte', address: 'Av. Santos Dumont, 1979', neighborhood: 'Santana',
      price: 35, priceMax: 180, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=800&q=80',
      ticketUrl: 'https://sympla.com.br', source: 'Sympla', sourceUrl: 'https://sympla.com.br',
      tags: ['aviacao', 'campo de marte', 'avioes', 'santana', 'expo'],
    },
    {
      id: generateId('standup_minhoca', 'Stand Up Comedy All Stars Minhoca', oct(20, 20, 30)),
      title: 'Stand-Up Comedy All-Stars — Clube do Minhoca',
      description: 'Noite com os 5 maiores nomes da nova geração do humor stand-up nacional em um dos clubes de comédia mais charmosos do centro de SP. Risadas garantidas e drinks artesanais.',
      category: 'teatro', date: oct(20, 20, 30), time: '20:30',
      location: 'Clube do Minhoca', address: 'Rua Conselheiro Nébias, 131', neighborhood: 'Campos Elíseos',
      price: 45, priceMax: 70, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1508345228704-935cc84bf5e2?w=800&q=80',
      ticketUrl: 'https://clubedominhoca.com.br', source: 'Clube do Minhoca', sourceUrl: 'https://clubedominhoca.com.br',
      tags: ['stand up', 'comedia', 'teatro', 'humor', 'centro'],
    },
    {
      id: generateId('passeio_ciclistico_sp', 'Passeio Ciclistico Noturno Paulista', oct(21, 20)),
      title: 'Passeio Ciclístico Noturno de São Paulo (Gratuito)',
      description: 'Passeio ciclístico de 15km pelas vias icônicas de SP iluminadas à noite: Av. Paulista, Minhocão, Praça Roosevelt e Vale do Anhangabaú. Apoio mecânico, batedores da CET e ritmo leve para ciclistas de todas as idades.',
      category: 'esporte', date: oct(21, 20), time: '20:00',
      location: 'Praça do Ciclista — Av. Paulista', address: 'Av. Paulista, 2444', neighborhood: 'Bela Vista',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1558618047-3c8c76ca7d13?w=800&q=80',
      ticketUrl: 'https://www.prefeitura.sp.gov.br', source: 'Prefeitura SP', sourceUrl: 'https://www.prefeitura.sp.gov.br',
      tags: ['ciclismo', 'bike', 'esporte', 'paulista', 'gratuito'],
    },
    {
      id: generateId('farol_santander_ocultismo', 'Farol Santander Ocultismo Mitologias', oct(22, 9)),
      title: 'Farol Santander: Exposição "Ocultismo e Mitologias Antigas"',
      description: 'Instalação imersiva de artes visuais explorando as raízes do misticismo, símbolos esotéricos e lendas antigas através de esculturas, hologramas e projeções sonoras 8D. Visita inclui o mirante no 26º andar.',
      category: 'exposicao', date: oct(22, 9), time: '09:00',
      location: 'Farol Santander', address: 'Rua João Brícola, 24 — Centro', neighborhood: 'Centro Histórico',
      price: 35, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1580060839134-75a5edca2e99?w=800&q=80',
      ticketUrl: 'https://farolsantander.com.br', source: 'Farol Santander', sourceUrl: 'https://farolsantander.com.br',
      tags: ['farol santander', 'exposicao', 'arte', 'mirante', 'centro'],
    },
    {
      id: generateId('night_run_sp', 'Night Run SP Sambodromo', oct(24, 19)),
      title: 'Night Run SP — Corrida Noturna no Sambódromo do Anhembi',
      description: 'A corrida noturna mais eletrizante do Brasil! Circuitos de 5km e 10km na passarela do samba com túneis de luz neon, DJs tocando ao longo do percurso, show na chegada e arena com massagem e hidratação.',
      category: 'esporte', date: oct(24, 19), time: '19:00',
      location: 'Sambódromo do Anhembi', address: 'Av. Olavo Fontoura, 1209 — Santana', neighborhood: 'Santana',
      price: 89, priceMax: 160, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1452626038306-9aae5e071b52?w=800&q=80',
      ticketUrl: 'https://runningland.com.br', source: 'Night Run', sourceUrl: 'https://runningland.com.br',
      tags: ['corrida', 'night run', 'esporte', 'anhembi', 'fitness'],
    },

    // ══════════════════════════════════════════════════════════════════════════
    // 🏛️ INSTITUIÇÕES & DIAS DA SEMANA (SETEMBRO E OUTUBRO) 🏛️
    // ══════════════════════════════════════════════════════════════════════════
    {
      id: generateId('masp', 'MASP Terça Grátis', oct(6, 10)),
      title: 'MASP — "Histórias Paulistanas": Obras do Acervo Permanente (Terça Grátis)',
      description: 'A fantástica expografia nos cavaletes de cristal de Lina Bo Bardi reunindo obras de Van Gogh, Cézanne e Tarsila do Amaral. Entrada gratuita toda terça-feira mediante agendamento.',
      category: 'exposicao', date: oct(6, 10), time: '10:00',
      location: 'MASP', address: 'Av. Paulista, 1578', neighborhood: 'Bela Vista',
      price: 0, isFree: true, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1580060839134-75a5edca2e99?w=800&q=80',
      ticketUrl: 'https://masp.org.br', source: 'MASP', sourceUrl: 'https://masp.org.br',
      tags: ['masp', 'arte', 'museu', 'paulista', 'exposicao', 'gratuito'],
    },
    {
      id: generateId('pinacoteca', 'Pinacoteca Sábado Grátis', oct(10, 10)),
      title: 'Pinacoteca de São Paulo — Arte Brasileira dos Séculos XIX e XX (Sábado Grátis)',
      description: 'A mais antiga instituição de arte de São Paulo apresenta seu acervo magistral, incluindo obras icônicas como O Mestiço e Saudade. Entrada franca aos sábados.',
      category: 'exposicao', date: oct(10, 10), time: '10:00',
      location: 'Pinacoteca do Estado', address: 'Praça da Luz, 2 — Luz', neighborhood: 'Luz',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1518998053901-5348d3961a04?w=800&q=80',
      ticketUrl: 'https://pinacoteca.org.br', source: 'Pinacoteca SP', sourceUrl: 'https://pinacoteca.org.br',
      tags: ['pinacoteca', 'arte brasileira', 'museu', 'luz', 'exposicao', 'gratuito'],
    },
    {
      id: generateId('osesp', 'Concerto Sinfônico OSESP', oct(11, 16)),
      title: 'Concerto Sinfônico OSESP na Sala São Paulo',
      description: 'A Orquestra Sinfônica do Estado de São Paulo apresenta a 9ª Sinfonia de Beethoven com coro completo em uma das salas com melhor acústica do mundo.',
      category: 'musica', date: oct(11, 16), time: '16:00',
      location: 'Sala São Paulo', address: 'Praça Júlio Prestes, 16', neighborhood: 'Luz',
      price: 35, priceMax: 180, isFree: false, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=800&q=80',
      ticketUrl: 'https://osesp.art.br', source: 'OSESP', sourceUrl: 'https://osesp.art.br',
      tags: ['osesp', 'musica classica', 'sala sao paulo'],
    },
    {
      id: generateId('paulista_aberta', 'Domingo Sem Carro Av Paulista Aberta', oct(11, 8)),
      title: 'Domingo Sem Carro na Av. Paulista — Cultura e Esporte na Rua (Gratuito)',
      description: 'A avenida mais famosa do Brasil fechada para veículos e aberta exclusivamente para pedestres, ciclistas e skatistas. Shows acústicos a cada quarteirão, feira de artesãos e aulas coletivas de dança.',
      category: 'esporte', date: oct(11, 8), endDate: oct(11, 16), time: '08:00',
      location: 'Avenida Paulista', address: 'Av. Paulista, toda a extensão', neighborhood: 'Bela Vista',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1558618047-3c8c76ca7d13?w=800&q=80',
      ticketUrl: 'https://www.prefeitura.sp.gov.br', source: 'Prefeitura SP', sourceUrl: 'https://www.prefeitura.sp.gov.br',
      tags: ['paulista aberta', 'esporte', 'lazer', 'gratuito', 'musica de rua'],
    },
    {
      id: generateId('ims_paulista', 'IMS Paulista Fotografia Contemporanea', oct(18, 10)),
      title: 'IMS Paulista — Fotografia Contemporânea Brasileira (Gratuito)',
      description: 'Exposição fotográfica em três andares do Instituto Moreira Salles, com terraço panorâmico e centro de documentação de fotografia do Brasil. Totalmente gratuito.',
      category: 'exposicao', date: oct(18, 10), time: '10:00',
      location: 'IMS Paulista', address: 'Av. Paulista, 2424', neighborhood: 'Bela Vista',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=800&q=80',
      ticketUrl: 'https://ims.com.br', source: 'IMS', sourceUrl: 'https://ims.com.br',
      tags: ['ims', 'fotografia', 'paulista', 'gratuito', 'exposicao'],
    },
    {
      id: generateId('sesc_pinheiros', 'SESC Pinheiros Festival Jazz', oct(23, 20)),
      title: 'SESC Pinheiros — Festival de Jazz Contemporâneo',
      description: 'Três noites de jazz com instrumentistas nacionais e internacionais. Masterclasses gratuitas e jam sessions abertas ao público após as apresentações principais.',
      category: 'musica', date: oct(23, 20), endDate: oct(25, 23), time: '20:00',
      location: 'SESC Pinheiros', address: 'Rua Paes Leme, 195', neighborhood: 'Pinheiros',
      price: 0, isFree: true, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?w=800&q=80',
      ticketUrl: 'https://www.sescsp.org.br/agenda/', source: 'SESC SP', sourceUrl: 'https://www.sescsp.org.br/agenda/',
      tags: ['jazz', 'sesc pinheiros', 'musica', 'gratuito'],
    },
    {
      id: generateId('catavento_planetario', 'Museu Catavento Ciencia Interativa', oct(12, 9)),
      title: 'Museu Catavento — Ciência Interativa e Planetário',
      description: 'O museu de ciências mais divertido do Brasil instalado no Palácio das Indústrias: gerador Van de Graaff, nave espacial com simulação, borboletário e sala de astronomia. Ideal para mentes curiosas.',
      category: 'infantil', date: oct(12, 9), time: '09:00',
      location: 'Museu Catavento', address: 'Av. Mercúrio, s/n — Brás', neighborhood: 'Brás',
      price: 18, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?w=800&q=80',
      ticketUrl: 'https://museucatavento.org.br', source: 'Catavento', sourceUrl: 'https://museucatavento.org.br',
      tags: ['catavento', 'ciencia', 'infantil', 'museu', 'planetario'],
    },
    {
      id: generateId('mercadao_sp', 'Mercado Municipal SP Tour', oct(25, 8)),
      title: 'Mercado Municipal de SP — Tour Gastronômico Paulistano de Domingo',
      description: 'Visita gastronômica ao histórico Mercadão de São Paulo: o famoso sanduíche de mortadela gigante, pastel de bacalhau crocante e frutas raras de todas as regiões tropicais do Brasil.',
      category: 'gastronomia', date: oct(25, 8), time: '08:00',
      location: 'Mercado Municipal de SP', address: 'R. da Cantareira, 306 — Centro', neighborhood: 'Centro Histórico',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&q=80',
      ticketUrl: 'https://mercadaomunicipal.com.br', source: 'Mercadão SP', sourceUrl: 'https://mercadaomunicipal.com.br',
      tags: ['mercadao', 'gastronomia', 'centro', 'pastel de bacalhau', 'comida'],
    },
    {
      id: generateId('benedito_calixto', 'Feira Benedito Calixto Jazz', oct(24, 18)),
      title: 'Feira Noturna Gastronômica & Jazz — Praça Benedito Calixto (Gratuito)',
      description: 'Edição noturna especial com barraquinhas de gastronomia de rua (hambúrgueres artesanais, empanadas argentinas, churros e chopes locais) acompanhada de shows de jazz e choro sob as árvores da praça.',
      category: 'gastronomia', date: oct(24, 18), endDate: oct(24, 23), time: '18:00',
      location: 'Praça Benedito Calixto', address: 'Praça Benedito Calixto, s/n', neighborhood: 'Pinheiros',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800&q=80',
      ticketUrl: 'https://beneditocalixto.com.br', source: 'Benedito Calixto', sourceUrl: 'https://beneditocalixto.com.br',
      tags: ['gastronomia', 'benedito calixto', 'pinheiros', 'jazz', 'gratuito'],
    },
    // Setembro marcos
    {
      id: generateId('masp_set', 'MASP Terça Grátis Setembro', sep(29, 10)),
      title: 'MASP — "Histórias Paulistanas": Obras do Acervo Permanente (Terça Grátis)',
      description: 'A fantástica expografia nos cavaletes de cristal de Lina Bo Bardi reunindo obras de Van Gogh, Cézanne e Tarsila do Amaral. Entrada gratuita toda terça-feira mediante agendamento.',
      category: 'exposicao', date: sep(29, 10), time: '10:00',
      location: 'MASP', address: 'Av. Paulista, 1578', neighborhood: 'Bela Vista',
      price: 0, isFree: true, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1580060839134-75a5edca2e99?w=800&q=80',
      ticketUrl: 'https://masp.org.br', source: 'MASP', sourceUrl: 'https://masp.org.br',
      tags: ['masp', 'arte', 'museu', 'paulista', 'exposicao', 'gratuito'],
    },
    {
      id: generateId('pinacoteca_set', 'Pinacoteca Sábado Grátis Setembro', sep(27, 10)),
      title: 'Pinacoteca de São Paulo — Arte Brasileira dos Séculos XIX e XX (Sábado Grátis)',
      description: 'A mais antiga instituição de arte de São Paulo apresenta seu acervo magistral, incluindo obras icônicas como O Mestiço e Saudade. Entrada franca aos sábados.',
      category: 'exposicao', date: sep(27, 10), time: '10:00',
      location: 'Pinacoteca do Estado', address: 'Praça da Luz, 2 — Luz', neighborhood: 'Luz',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1518998053901-5348d3961a04?w=800&q=80',
      ticketUrl: 'https://pinacoteca.org.br', source: 'Pinacoteca SP', sourceUrl: 'https://pinacoteca.org.br',
      tags: ['pinacoteca', 'arte brasileira', 'museu', 'luz', 'exposicao', 'gratuito'],
    },
    {
      id: generateId('osesp_set', 'Concerto Sinfônico OSESP Setembro', sep(28, 16)),
      title: 'Concerto Sinfônico OSESP na Sala São Paulo',
      description: 'A Orquestra Sinfônica do Estado de São Paulo apresenta a 9ª Sinfonia de Beethoven com coro completo em uma das salas com melhor acústica do mundo.',
      category: 'musica', date: sep(28, 16), time: '16:00',
      location: 'Sala São Paulo', address: 'Praça Júlio Prestes, 16', neighborhood: 'Luz',
      price: 35, priceMax: 180, isFree: false, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=800&q=80',
      ticketUrl: 'https://osesp.art.br', source: 'OSESP', sourceUrl: 'https://osesp.art.br',
      tags: ['osesp', 'musica classica', 'sala sao paulo'],
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

import type { Event, EventCategory } from '../types/event';
import { startOfMonth, endOfMonth, addMonths, format, parseISO } from 'date-fns';

const CACHE_KEY = 'sp_eventos_cache';
const CACHE_TIMESTAMP_KEY = 'sp_eventos_cache_ts';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// ─── Utility ────────────────────────────────────────────────────────────────

function generateId(source: string, title: string, date: string): string {
  const str = `${source}-${title}-${date}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function buildProxyUrl(targetUrl: string): string {
  // Use allorigins as CORS proxy for client-side scraping
  return `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
}

async function fetchWithProxy(url: string): Promise<string> {
  const proxyUrl = buildProxyUrl(url);
  const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const json = await res.json();
  return json.contents as string;
}

// ─── Source: Sympla ─────────────────────────────────────────────────────────

async function fetchSympla(from: string, to: string): Promise<Event[]> {
  try {
    // Sympla public search page for São Paulo
    const url = `https://www.sympla.com.br/eventos/sao-paulo-sp?page=1&s=${from}&e=${to}`;
    const html = await fetchWithProxy(url);
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const events: Event[] = [];

    // Sympla uses data in script tags (JSON-LD) and card elements
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    scripts.forEach((script) => {
      try {
        const data = JSON.parse(script.textContent || '');
        const items = Array.isArray(data) ? data : data['@graph'] || [data];
        items.forEach((item: Record<string, unknown>) => {
          if (item['@type'] === 'Event' || item['@type'] === 'MusicEvent') {
            const locationObj = item.location as Record<string, unknown> | undefined;
            const offersArr = item.offers as Record<string, unknown>[] | undefined;
            const performerArr = item.performer as Record<string, unknown>[] | undefined;
            const organizer = item.organizer as Record<string, unknown> | undefined;
            void organizer;
            void performerArr;

            const startDate = (item.startDate as string) || '';
            const endDate = (item.endDate as string) || undefined;
            const imageObj = item.image as Record<string, unknown> | undefined;
            const imageUrl = typeof item.image === 'string'
              ? item.image
              : (imageObj?.url as string) || undefined;

            const priceStr = offersArr?.[0]?.price as number | undefined;
            const price = Number(priceStr) || 0;
            const eventUrl = item.url as string || '';

            events.push({
              id: generateId('sympla', item.name as string, startDate),
              title: item.name as string,
              description: item.description as string || '',
              category: guessCategory(item.name as string, item.description as string),
              date: startDate,
              endDate,
              location: (locationObj?.name as string) || 'São Paulo',
              address: (locationObj?.address as Record<string, unknown>)?.streetAddress as string,
              neighborhood: '',
              price,
              isFree: price === 0,
              imageUrl,
              ticketUrl: eventUrl,
              source: 'Sympla',
              sourceUrl: eventUrl,
            });
          }
        });
      } catch {
        // skip malformed JSON-LD
      }
    });

    return events;
  } catch (err) {
    console.warn('[Sympla] fetch failed:', err);
    return [];
  }
}

// ─── Source: Eventbrite ─────────────────────────────────────────────────────

async function fetchEventbrite(from: string, to: string): Promise<Event[]> {
  try {
    const url = `https://www.eventbrite.com.br/d/brazil--s%C3%A3o-paulo/events/?start_date=${from}&end_date=${to}`;
    const html = await fetchWithProxy(url);
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const events: Event[] = [];

    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    scripts.forEach((script) => {
      try {
        const data = JSON.parse(script.textContent || '');
        const items = Array.isArray(data) ? data : [data];
        items.forEach((item: Record<string, unknown>) => {
          if (item['@type'] === 'Event') {
            const locationObj = item.location as Record<string, unknown> | undefined;
            const offersArr = item.offers as Record<string, unknown>[] | undefined;
            const startDate = (item.startDate as string) || '';
            const price = Number((offersArr?.[0]?.price as string) || 0);
            const imageObj = item.image as Record<string, unknown> | undefined;
            const imageUrl = typeof item.image === 'string'
              ? item.image
              : (imageObj?.url as string) || undefined;

            events.push({
              id: generateId('eventbrite', item.name as string, startDate),
              title: item.name as string,
              description: item.description as string || '',
              category: guessCategory(item.name as string, item.description as string),
              date: startDate,
              location: (locationObj?.name as string) || 'São Paulo',
              address: (locationObj?.address as Record<string, unknown>)?.streetAddress as string,
              neighborhood: '',
              price,
              isFree: price === 0,
              imageUrl,
              ticketUrl: item.url as string,
              source: 'Eventbrite',
              sourceUrl: item.url as string || '',
            });
          }
        });
      } catch {
        // skip
      }
    });

    return events;
  } catch (err) {
    console.warn('[Eventbrite] fetch failed:', err);
    return [];
  }
}

// ─── Source: Secretaria de Cultura SP (sampa.art) ───────────────────────────

async function fetchSampaCultura(): Promise<Event[]> {
  try {
    // Using São Paulo city open data API
    const url = `https://sampa.art/api/v2/events?limit=100&city=São Paulo`;
    const html = await fetchWithProxy(url);
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(html);
    } catch {
      return [];
    }

    const items = (data.results as Record<string, unknown>[]) || [];
    return items.map((item) => {
      const startDate = (item.date_start as string) || '';
      const price = Number(item.price || 0);
      return {
        id: generateId('sampa_art', item.title as string, startDate),
        title: item.title as string || '',
        description: item.description as string || '',
        category: guessCategory(item.title as string, (item.category as string) || ''),
        date: startDate,
        endDate: item.date_end as string,
        location: (item.venue_name as string) || 'São Paulo',
        address: item.address as string,
        neighborhood: item.neighborhood as string,
        price,
        isFree: price === 0,
        imageUrl: item.image as string,
        ticketUrl: item.event_url as string,
        source: 'Sampa.Art',
        sourceUrl: (item.event_url as string) || 'https://sampa.art',
      };
    });
  } catch (err) {
    console.warn('[SampaCultura] fetch failed:', err);
    return [];
  }
}

// ─── Source: Agenda Cultural SP (prefeitura) ────────────────────────────────

async function fetchAgendaCulturalSP(): Promise<Event[]> {
  try {
    const url = 'https://www.prefeitura.sp.gov.br/cidade/secretarias/cultura/agenda/index.php';
    const html = await fetchWithProxy(url);
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const events: Event[] = [];

    // Parse event cards from prefeitura page
    const cards = doc.querySelectorAll('.evento, .card-evento, article[class*="event"], .agenda-item');
    cards.forEach((card) => {
      const title = card.querySelector('h2, h3, .titulo, .title')?.textContent?.trim() || '';
      const description = card.querySelector('p, .descricao, .description')?.textContent?.trim() || '';
      const dateText = card.querySelector('.data, .date, time')?.textContent?.trim() || '';
      const location = card.querySelector('.local, .location, .venue')?.textContent?.trim() || 'São Paulo';
      const link = (card.querySelector('a') as HTMLAnchorElement)?.href || '';
      const img = (card.querySelector('img') as HTMLImageElement)?.src || '';

      if (!title) return;

      events.push({
        id: generateId('prefeitura_sp', title, dateText),
        title,
        description,
        category: guessCategory(title, description),
        date: parseBrazilianDate(dateText) || new Date().toISOString(),
        location,
        price: 0,
        isFree: true,
        imageUrl: img,
        ticketUrl: link,
        source: 'Prefeitura SP',
        sourceUrl: link || 'https://www.prefeitura.sp.gov.br/cidade/secretarias/cultura/agenda/',
      });
    });

    return events;
  } catch (err) {
    console.warn('[AgendaSP] fetch failed:', err);
    return [];
  }
}

// ─── Source: G1 SP Eventos ──────────────────────────────────────────────────

async function fetchG1SPEventos(): Promise<Event[]> {
  try {
    const url = 'https://g1.globo.com/sp/sao-paulo/agenda-de-eventos/';
    const html = await fetchWithProxy(url);
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const events: Event[] = [];

    // G1 uses feed items / article cards
    const articles = doc.querySelectorAll('article, .feed-post-body, [class*="post-item"]');
    articles.forEach((art) => {
      const title = art.querySelector('h2, h3, [class*="title"], [class*="headline"]')?.textContent?.trim() || '';
      const description = art.querySelector('p, [class*="summary"], [class*="description"]')?.textContent?.trim() || '';
      const dateText = art.querySelector('time, [class*="date"], [class*="hora"]')?.getAttribute('datetime') || '';
      const link = (art.querySelector('a') as HTMLAnchorElement)?.href || '';
      const img = (art.querySelector('img') as HTMLImageElement)?.src || '';

      if (!title || title.length < 5) return;

      events.push({
        id: generateId('g1_sp', title, dateText),
        title,
        description,
        category: guessCategory(title, description),
        date: dateText || new Date().toISOString(),
        location: 'São Paulo',
        price: 0,
        isFree: description.toLowerCase().includes('gratuito') || description.toLowerCase().includes('grátis') || title.toLowerCase().includes('grátis'),
        imageUrl: img,
        ticketUrl: link,
        source: 'G1 SP',
        sourceUrl: link || 'https://g1.globo.com/sp/sao-paulo/agenda-de-eventos/',
      });
    });

    return events;
  } catch (err) {
    console.warn('[G1 SP] fetch failed:', err);
    return [];
  }
}

// ─── Source: Catraca Livre SP ────────────────────────────────────────────────

async function fetchCatracaLivre(): Promise<Event[]> {
  try {
    const url = 'https://catracalivre.com.br/agenda/sp/';
    const html = await fetchWithProxy(url);
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const events: Event[] = [];

    const cards = doc.querySelectorAll('article, .card, [class*="post"]');
    cards.forEach((card) => {
      const title = card.querySelector('h2, h3, [class*="title"]')?.textContent?.trim() || '';
      const description = card.querySelector('p, [class*="excerpt"], [class*="description"]')?.textContent?.trim() || '';
      const link = (card.querySelector('a') as HTMLAnchorElement)?.href || '';
      const img = (card.querySelector('img') as HTMLImageElement)?.src || '';
      const dateAttr = card.querySelector('time')?.getAttribute('datetime') || '';
      const isFree = title.toLowerCase().includes('grátis') || title.toLowerCase().includes('gratuito') ||
                     description.toLowerCase().includes('gratuito') || description.toLowerCase().includes('entrada gratuita');

      if (!title || title.length < 5) return;

      events.push({
        id: generateId('catraca_livre', title, dateAttr),
        title,
        description,
        category: guessCategory(title, description),
        date: dateAttr || new Date().toISOString(),
        location: 'São Paulo',
        price: isFree ? 0 : 0,
        isFree,
        imageUrl: img,
        ticketUrl: link,
        source: 'Catraca Livre',
        sourceUrl: link || 'https://catracalivre.com.br/agenda/sp/',
      });
    });

    return events;
  } catch (err) {
    console.warn('[CatracaLivre] fetch failed:', err);
    return [];
  }
}

// ─── Source: Balada SP ───────────────────────────────────────────────────────

async function fetchBaladaSP(): Promise<Event[]> {
  try {
    const url = 'https://balada.sp.gov.br/agenda';
    const html = await fetchWithProxy(url);
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const events: Event[] = [];

    const cards = doc.querySelectorAll('[class*="event"], [class*="agenda"], article');
    cards.forEach((card) => {
      const title = card.querySelector('h2, h3, [class*="title"]')?.textContent?.trim() || '';
      const description = card.querySelector('p, [class*="description"]')?.textContent?.trim() || '';
      const dateText = card.querySelector('time, [class*="date"]')?.textContent?.trim() || '';
      const link = (card.querySelector('a') as HTMLAnchorElement)?.href || '';
      const img = (card.querySelector('img') as HTMLImageElement)?.src || '';

      if (!title) return;

      events.push({
        id: generateId('balada_sp', title, dateText),
        title,
        description,
        category: guessCategory(title, description),
        date: parseBrazilianDate(dateText) || new Date().toISOString(),
        location: 'São Paulo',
        price: 0,
        isFree: true,
        imageUrl: img,
        ticketUrl: link,
        source: 'Balada SP',
        sourceUrl: link || 'https://balada.sp.gov.br/',
      });
    });

    return events;
  } catch (err) {
    console.warn('[BaladaSP] fetch failed:', err);
    return [];
  }
}

// ─── Mock/Fallback data (ensures app always has content) ────────────────────

function generateMockEvents(): Event[] {
  const today = new Date();
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();

  const mockData: Omit<Event, 'id'>[] = [
    {
      title: 'Festival de Jazz no SESC Pinheiros',
      description: 'Três dias de jazz com artistas nacionais e internacionais. Programação especial com workshops e masterclasses.',
      category: 'musica',
      date: new Date(currentYear, currentMonth, 5, 20, 0).toISOString(),
      endDate: new Date(currentYear, currentMonth, 7, 23, 0).toISOString(),
      time: '20:00',
      location: 'SESC Pinheiros',
      address: 'Rua Paes Leme, 195 - Pinheiros',
      neighborhood: 'Pinheiros',
      price: 0,
      isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?w=800&q=80',
      ticketUrl: 'https://sescsp.org.br',
      source: 'SESC SP',
      sourceUrl: 'https://sescsp.org.br',
      featured: true,
    },
    {
      title: 'Exposição "Memórias de São Paulo" - MASP',
      description: 'Retrospectiva fotográfica com 200 imagens históricas da cidade de São Paulo desde 1900. Entrada gratuita aos domingos.',
      category: 'exposicao',
      date: new Date(currentYear, currentMonth, 1).toISOString(),
      endDate: new Date(currentYear, currentMonth + 1, 30).toISOString(),
      location: 'MASP - Museu de Arte de São Paulo',
      address: 'Av. Paulista, 1578 - Bela Vista',
      neighborhood: 'Bela Vista',
      price: 60,
      priceMax: 120,
      isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1580060839134-75a5edca2e99?w=800&q=80',
      ticketUrl: 'https://masp.org.br',
      source: 'MASP',
      sourceUrl: 'https://masp.org.br',
      featured: true,
    },
    {
      title: 'Show: Lenine ao Vivo - Vibra São Paulo',
      description: 'O cantor e compositor pernambucano Lenine traz sua nova turnê para São Paulo com clássicos e músicas inéditas.',
      category: 'musica',
      date: new Date(currentYear, currentMonth, 12, 21, 0).toISOString(),
      time: '21:00',
      location: 'Vibra São Paulo',
      address: 'Av. das Nações Unidas, 17955 - Vila Almeida',
      neighborhood: 'Vila Almeida',
      price: 120,
      priceMax: 320,
      isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=800&q=80',
      ticketUrl: 'https://sympla.com.br',
      source: 'Sympla',
      sourceUrl: 'https://sympla.com.br',
    },
    {
      title: 'Peça: "O Beijo no Asfalto" - Teatro Oficina',
      description: 'Clássico de Nelson Rodrigues em nova montagem dirigida por Zé Celso Martinez Corrêa. Uma obra inesquecível do teatro brasileiro.',
      category: 'teatro',
      date: new Date(currentYear, currentMonth, 8, 20, 0).toISOString(),
      endDate: new Date(currentYear, currentMonth + 1, 8).toISOString(),
      time: '20:00',
      location: 'Teatro Oficina',
      address: 'Rua Jaceguai, 520 - Bela Vista',
      neighborhood: 'Bela Vista',
      price: 50,
      priceMax: 80,
      isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1503095396549-807759245b35?w=800&q=80',
      ticketUrl: 'https://www.teatroficina.com.br',
      source: 'Teatro Oficina',
      sourceUrl: 'https://www.teatroficina.com.br',
    },
    {
      title: 'Feira Gastronômica do Parque Ibirapuera',
      description: 'Mais de 80 expositores de gastronomia paulistana. Comidas regionais, food trucks, chefs renomados e muito sabor.',
      category: 'gastronomia',
      date: new Date(currentYear, currentMonth, 15, 10, 0).toISOString(),
      endDate: new Date(currentYear, currentMonth, 17, 21, 0).toISOString(),
      time: '10:00',
      location: 'Parque Ibirapuera',
      address: 'Av. Pedro Álvares Cabral, s/n - Vila Mariana',
      neighborhood: 'Vila Mariana',
      price: 0,
      isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800&q=80',
      ticketUrl: 'https://ibirapuera.org',
      source: 'Parque Ibirapuera',
      sourceUrl: 'https://ibirapuera.org',
    },
    {
      title: 'Campus Party São Paulo 2025',
      description: 'O maior festival de tecnologia e inovação da América Latina. Hackathons, palestras com referências globais, networking e muito mais.',
      category: 'tecnologia',
      date: new Date(currentYear, currentMonth, 20, 9, 0).toISOString(),
      endDate: new Date(currentYear, currentMonth, 24, 22, 0).toISOString(),
      time: '09:00',
      location: 'Expo Center Norte',
      address: 'Rua José Bernardo Pinto, 333 - Vila Guilherme',
      neighborhood: 'Vila Guilherme',
      price: 150,
      priceMax: 500,
      isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=800&q=80',
      ticketUrl: 'https://campusparty.com.br',
      source: 'Campus Party',
      sourceUrl: 'https://campusparty.com.br',
      featured: true,
    },
    {
      title: 'Voo de Balão e Exposição Aeronáutica - Campo de Marte',
      description: 'Exposição de aeronaves históricas e modernas. Simuladores de voo, voos panorâmicos de helicóptero e apresentações acrobáticas.',
      category: 'aviacao',
      date: new Date(currentYear, currentMonth, 18, 9, 0).toISOString(),
      endDate: new Date(currentYear, currentMonth, 19, 18, 0).toISOString(),
      time: '09:00',
      location: 'Aeroporto Campo de Marte',
      address: 'Av. Santos Dumont, 1979 - Santana',
      neighborhood: 'Santana',
      price: 30,
      priceMax: 200,
      isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=800&q=80',
      ticketUrl: 'https://sympla.com.br',
      source: 'Sympla',
      sourceUrl: 'https://sympla.com.br',
    },
    {
      title: 'Sarau Literário - Livraria Cultura',
      description: 'Noite de poesia e prosa com autores paulistanos. Lançamento de livros, debates e sessão de autógrafos.',
      category: 'literatura',
      date: new Date(currentYear, currentMonth, 10, 19, 0).toISOString(),
      time: '19:00',
      location: 'Livraria Cultura - Conjunto Nacional',
      address: 'Av. Paulista, 2073 - Bela Vista',
      neighborhood: 'Bela Vista',
      price: 0,
      isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=800&q=80',
      ticketUrl: 'https://livrariacultura.com.br',
      source: 'Livraria Cultura',
      sourceUrl: 'https://livrariacultura.com.br',
    },
    {
      title: 'Ballet "Lago dos Cisnes" - Teatro Municipal',
      description: 'O clássico balé de Tchaikovsky interpretado pelo Ballet da Cidade de São Paulo. Uma noite de arte e emoção.',
      category: 'danca',
      date: new Date(currentYear, currentMonth, 22, 20, 30).toISOString(),
      endDate: new Date(currentYear, currentMonth, 25).toISOString(),
      time: '20:30',
      location: 'Teatro Municipal de São Paulo',
      address: 'Praça Ramos de Azevedo, s/n - Centro',
      neighborhood: 'Centro',
      price: 80,
      priceMax: 300,
      isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1518611507888-3e15cce98b21?w=800&q=80',
      ticketUrl: 'https://theatromunicipal.org.br',
      source: 'Teatro Municipal',
      sourceUrl: 'https://theatromunicipal.org.br',
    },
    {
      title: 'SP Esporte Fest - Maratona e Corridas',
      description: 'Festival de esportes urbanos na Av. Paulista. Maratona, ciclismo, skate e muito mais. Evento gratuito para participantes e espectadores.',
      category: 'esporte',
      date: new Date(currentYear, currentMonth, 28, 6, 0).toISOString(),
      time: '06:00',
      location: 'Avenida Paulista',
      address: 'Av. Paulista, s/n - Bela Vista',
      neighborhood: 'Bela Vista',
      price: 0,
      isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1452626038306-9aae5e071b52?w=800&q=80',
      ticketUrl: 'https://spesportefest.com.br',
      source: 'SP Esporte',
      sourceUrl: 'https://spesportefest.com.br',
    },
    {
      title: 'Sessão Infantil: "Mundo das Histórias" - Sesc Belenzinho',
      description: 'Espetáculo de teatro de fantoches e contação de histórias para crianças de 3 a 10 anos. Entrada gratuita com reserva antecipada.',
      category: 'infantil',
      date: new Date(currentYear, currentMonth, 14, 15, 0).toISOString(),
      time: '15:00',
      location: 'SESC Belenzinho',
      address: 'R. Padre Adelino, 1000 - Belenzinho',
      neighborhood: 'Belenzinho',
      price: 0,
      isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?w=800&q=80',
      ticketUrl: 'https://sescsp.org.br',
      source: 'SESC SP',
      sourceUrl: 'https://sescsp.org.br',
    },
    {
      title: 'Carnaval Fora de Época - Bloco Acadêmicos do Baixo Augusta',
      description: 'O famoso bloco retorna com festa surpresa. Marchinha, frevo e axé no coração de São Paulo. Fantasia obrigatória!',
      category: 'festa',
      date: new Date(currentYear, currentMonth, 25, 14, 0).toISOString(),
      time: '14:00',
      location: 'Rua Augusta',
      address: 'Rua Augusta, s/n - Consolação',
      neighborhood: 'Consolação',
      price: 0,
      isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1551818255-e6e10975bc17?w=800&q=80',
      ticketUrl: 'https://sympla.com.br',
      source: 'Sympla',
      sourceUrl: 'https://sympla.com.br',
    },
    // Next month events
    {
      title: 'Bienal do Livro de São Paulo',
      description: 'A maior feira do livro da América Latina. Mais de 3.000 títulos, autores internacionais, lançamentos exclusivos e atividades culturais.',
      category: 'literatura',
      date: new Date(currentYear, currentMonth + 1, 3, 10, 0).toISOString(),
      endDate: new Date(currentYear, currentMonth + 1, 13, 21, 0).toISOString(),
      time: '10:00',
      location: 'Pavilhão da Bienal - Parque Ibirapuera',
      address: 'Portão 3 - Parque Ibirapuera',
      neighborhood: 'Vila Mariana',
      price: 30,
      priceMax: 60,
      isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1507842217343-583bb7270b66?w=800&q=80',
      ticketUrl: 'https://bienaldolivro.com.br',
      source: 'Bienal do Livro',
      sourceUrl: 'https://bienaldolivro.com.br',
      featured: true,
    },
    {
      title: 'São Paulo Fashion Week',
      description: 'A semana de moda mais importante da América Latina. Desfiles, showrooms e eventos exclusivos da moda brasileira.',
      category: 'cultura',
      date: new Date(currentYear, currentMonth + 1, 10, 18, 0).toISOString(),
      endDate: new Date(currentYear, currentMonth + 1, 15, 23, 0).toISOString(),
      time: '18:00',
      location: 'Complexo Geraldo de Alckmin',
      address: 'Rua Rego Freitas, 454 - República',
      neighborhood: 'República',
      price: 0,
      isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80',
      ticketUrl: 'https://spfw.com.br',
      source: 'SPFW',
      sourceUrl: 'https://spfw.com.br',
      featured: true,
    },
    {
      title: 'Festival de Cinema - Mostra Internacional',
      description: 'A Mostra Internacional de Cinema de São Paulo traz filmes de todo o mundo. Competição, retrospectivas e sessões especiais.',
      category: 'cinema',
      date: new Date(currentYear, currentMonth + 1, 20, 14, 0).toISOString(),
      endDate: new Date(currentYear, currentMonth + 2, 5).toISOString(),
      time: '14:00',
      location: 'Multiplas salas - Centro SP',
      address: 'Diversas Localizações - São Paulo',
      neighborhood: 'Centro',
      price: 25,
      priceMax: 50,
      isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=800&q=80',
      ticketUrl: 'https://mostra.org',
      source: 'Mostra SP',
      sourceUrl: 'https://mostra.org',
    },
  ];

  return mockData.map((e) => ({
    ...e,
    id: generateId(e.source, e.title, e.date),
  }));
}

// ─── Category Guesser ────────────────────────────────────────────────────────

function guessCategory(title: string, description: string): EventCategory {
  const text = `${title} ${description}`.toLowerCase();

  if (/jazz|rock|show|música|concert|band|samba|forró|mpb|pop|metal|rap|funk|eletrôni|festival music/i.test(text)) return 'musica';
  if (/teatro|peça|espetáculo|cena|palco|dramaturgia|ópera/i.test(text)) return 'teatro';
  if (/exposiç|museu|galeria|arte|pintura|escultura|fotografia|instalação/i.test(text)) return 'exposicao';
  if (/gastro|culinária|chef|food|alimentação|vinho|cerveja|cervejaria|feira de comida/i.test(text)) return 'gastronomia';
  if (/esporte|corrida|maratona|futebol|tênis|basquete|vôlei|ciclismo|natação|fitness/i.test(text)) return 'esporte';
  if (/tech|tecnologia|startup|programação|inovaç|digital|hackathon|developer|TI\b/i.test(text)) return 'tecnologia';
  if (/aviaç|aeronave|avião|helicóptero|piloto|voo|aeroporto|aeronáutica/i.test(text)) return 'aviacao';
  if (/cinema|filme|movie|sessão|curta|longa/i.test(text)) return 'cinema';
  if (/dança|ballet|balé|coreografia|sapateado/i.test(text)) return 'danca';
  if (/livro|literatura|poesia|sarau|leitura|autor|escritor|bibliote/i.test(text)) return 'literatura';
  if (/infantil|criança|kids|família|brincar|fantoches|conto|fairy/i.test(text)) return 'infantil';
  if (/festa|party|carnaval|bloco|baile|balada|night|club/i.test(text)) return 'festa';
  if (/cultura|festival|tradição|patrimônio|artesanato|folclore/i.test(text)) return 'cultura';

  return 'outros';
}

// ─── Date Parser ─────────────────────────────────────────────────────────────

function parseBrazilianDate(dateStr: string): string | null {
  // Try "dd/mm/yyyy" or "dd de mês de yyyy"
  const ptMonths: Record<string, number> = {
    janeiro: 0, fevereiro: 1, março: 2, abril: 3, maio: 4, junho: 5,
    julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11,
  };

  const dmyMatch = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmyMatch) {
    const d = Number(dmyMatch[1]);
    const m = Number(dmyMatch[2]) - 1;
    const y = Number(dmyMatch[3]);
    const dt = new Date(y, m, d);
    return isNaN(dt.getTime()) ? null : dt.toISOString();
  }

  const ptMatch = dateStr.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
  if (ptMatch) {
    const d = Number(ptMatch[1]);
    const m = ptMonths[ptMatch[2].toLowerCase()];
    const y = Number(ptMatch[3]);
    if (m !== undefined) {
      const dt = new Date(y, m, d);
      return isNaN(dt.getTime()) ? null : dt.toISOString();
    }
  }

  return null;
}

// ─── Deduplication ───────────────────────────────────────────────────────────

function deduplicateEvents(events: Event[]): Event[] {
  const seen = new Map<string, Event>();
  events.forEach((e) => {
    const key = `${e.title.toLowerCase().slice(0, 30)}-${e.date.slice(0, 10)}`;
    if (!seen.has(key)) {
      seen.set(key, e);
    }
  });
  return Array.from(seen.values());
}

// ─── Main Aggregator ─────────────────────────────────────────────────────────

export async function fetchAllEvents(forceRefresh = false): Promise<Event[]> {
  // Check cache
  if (!forceRefresh) {
    const cached = localStorage.getItem(CACHE_KEY);
    const cachedTs = localStorage.getItem(CACHE_TIMESTAMP_KEY);
    if (cached && cachedTs) {
      const age = Date.now() - Number(cachedTs);
      if (age < CACHE_TTL_MS) {
        try {
          return JSON.parse(cached) as Event[];
        } catch {
          // fallthrough
        }
      }
    }
  }

  const now = new Date();
  const fromDate = format(startOfMonth(now), 'yyyy-MM-dd');
  const toDate = format(endOfMonth(addMonths(now, 1)), 'yyyy-MM-dd');
  void fromDate;
  void toDate;

  // Always start with mock events to ensure the app has content
  const mockEvents = generateMockEvents();

  // Try to fetch from real sources in parallel (they may fail due to CORS etc.)
  const [sympla, eventbrite, sampaCultura, prefeitura, g1, catracaLivre, balada] = await Promise.allSettled([
    fetchSympla(fromDate, toDate),
    fetchEventbrite(fromDate, toDate),
    fetchSampaCultura(),
    fetchAgendaCulturalSP(),
    fetchG1SPEventos(),
    fetchCatracaLivre(),
    fetchBaladaSP(),
  ]);

  const realEvents: Event[] = [
    ...(sympla.status === 'fulfilled' ? sympla.value : []),
    ...(eventbrite.status === 'fulfilled' ? eventbrite.value : []),
    ...(sampaCultura.status === 'fulfilled' ? sampaCultura.value : []),
    ...(prefeitura.status === 'fulfilled' ? prefeitura.value : []),
    ...(g1.status === 'fulfilled' ? g1.value : []),
    ...(catracaLivre.status === 'fulfilled' ? catracaLivre.value : []),
    ...(balada.status === 'fulfilled' ? balada.value : []),
  ];

  // Merge: real events take priority, mock events fill in
  const allEvents = deduplicateEvents([...realEvents, ...mockEvents]);

  // Filter to current + next month date range
  const rangeStart = startOfMonth(now);
  const rangeEnd = endOfMonth(addMonths(now, 1));

  const filtered = allEvents.filter((e) => {
    try {
      const eventDate = parseISO(e.date);
      return eventDate >= rangeStart && eventDate <= rangeEnd;
    } catch {
      return true;
    }
  });

  // Sort by date
  filtered.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Cache results
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(filtered));
    localStorage.setItem(CACHE_TIMESTAMP_KEY, String(Date.now()));
  } catch {
    // ignore storage errors
  }

  return filtered;
}

export function filterEvents(events: Event[], filters: {
  categories: EventCategory[];
  priceFilter: 'all' | 'free' | 'paid';
  searchQuery: string;
  selectedDate: Date | null;
}): Event[] {
  return events.filter((e) => {
    // Category filter
    if (filters.categories.length > 0 && !filters.categories.includes(e.category)) return false;

    // Price filter
    if (filters.priceFilter === 'free' && !e.isFree) return false;
    if (filters.priceFilter === 'paid' && e.isFree) return false;

    // Search filter
    if (filters.searchQuery) {
      const q = filters.searchQuery.toLowerCase();
      const match =
        e.title.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.location.toLowerCase().includes(q) ||
        (e.neighborhood || '').toLowerCase().includes(q);
      if (!match) return false;
    }

    // Date filter — compare as YYYY-MM-DD strings to avoid UTC timezone shift
    if (filters.selectedDate) {
      const sel = filters.selectedDate;
      // Build a local YYYY-MM-DD string for the selected date
      const selStr =
        `${sel.getFullYear()}-${String(sel.getMonth() + 1).padStart(2, '0')}-${String(sel.getDate()).padStart(2, '0')}`;

      const eventStartStr = e.date.slice(0, 10); // "YYYY-MM-DD"
      const eventEndStr = e.endDate ? e.endDate.slice(0, 10) : eventStartStr;

      // Event is on the selected day if:
      //  - it starts on that day, OR
      //  - it's a multi-day event that spans that day (start <= sel <= end)
      const startsOnDay = eventStartStr === selStr;
      const spansDay = eventStartStr <= selStr && eventEndStr >= selStr;

      if (!startsOnDay && !spansDay) return false;
    }

    return true;
  });
}

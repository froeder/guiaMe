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

// ─── Source: SESC SP ─────────────────────────────────────────────────────────
// SESC has 40+ units in SP and offers mostly free/low-cost cultural events

async function fetchSescSP(): Promise<Event[]> {
  try {
    const url = 'https://www.sescsp.org.br/agenda/';
    const html = await fetchWithProxy(url);
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const events: Event[] = [];

    // SESC site uses JSON-LD and structured cards
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    scripts.forEach((script) => {
      try {
        const data = JSON.parse(script.textContent || '');
        const items = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data];
        items.forEach((item: Record<string, unknown>) => {
          if (item['@type'] === 'Event' || item['@type'] === 'MusicEvent' || item['@type'] === 'TheaterEvent') {
            const locationObj = item.location as Record<string, unknown> | undefined;
            const offersArr = item.offers as Record<string, unknown>[] | undefined;
            const startDate = (item.startDate as string) || '';
            const price = Number((offersArr?.[0]?.price as string) || 0);
            const imageObj = item.image as Record<string, unknown> | undefined;
            const imageUrl = typeof item.image === 'string' ? item.image : (imageObj?.url as string) || undefined;

            if (!startDate || !(item.name as string)) return;

            events.push({
              id: generateId('sesc', item.name as string, startDate),
              title: item.name as string,
              description: (item.description as string) || '',
              category: guessCategory(item.name as string, (item.description as string) || ''),
              date: startDate,
              endDate: (item.endDate as string) || undefined,
              location: (locationObj?.name as string) || 'SESC SP',
              address: (locationObj?.address as Record<string, unknown>)?.streetAddress as string,
              neighborhood: '',
              price,
              isFree: price === 0,
              imageUrl,
              ticketUrl: item.url as string,
              source: 'SESC SP',
              sourceUrl: (item.url as string) || 'https://www.sescsp.org.br/agenda/',
            });
          }
        });
      } catch { /* skip */ }
    });

    // Fallback: parse card elements
    if (events.length === 0) {
      const cards = doc.querySelectorAll('[class*="card"], [class*="evento"], article');
      cards.forEach((card) => {
        const title = card.querySelector('h2, h3, [class*="title"], [class*="nome"]')?.textContent?.trim() || '';
        const description = card.querySelector('p, [class*="description"], [class*="descricao"]')?.textContent?.trim() || '';
        const link = (card.querySelector('a') as HTMLAnchorElement)?.href || '';
        const img = (card.querySelector('img') as HTMLImageElement)?.src || '';
        const dateAttr = card.querySelector('time')?.getAttribute('datetime') || card.querySelector('[class*="date"], [class*="data"]')?.textContent?.trim() || '';
        const local = card.querySelector('[class*="local"], [class*="unidade"]')?.textContent?.trim() || 'SESC SP';
        if (!title || title.length < 4) return;
        events.push({
          id: generateId('sesc', title, dateAttr),
          title,
          description,
          category: guessCategory(title, description),
          date: parseBrazilianDate(dateAttr) || new Date().toISOString(),
          location: local,
          price: 0,
          isFree: true,
          imageUrl: img,
          ticketUrl: link,
          source: 'SESC SP',
          sourceUrl: link || 'https://www.sescsp.org.br/agenda/',
        });
      });
    }

    return events;
  } catch (err) {
    console.warn('[SESC SP] fetch failed:', err);
    return [];
  }
}

// ─── Source: Centro Cultural São Paulo ───────────────────────────────────────

async function fetchCentroCulturalSP(): Promise<Event[]> {
  try {
    const url = 'https://centrocultural.sp.gov.br/programacao/';
    const html = await fetchWithProxy(url);
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const events: Event[] = [];

    const cards = doc.querySelectorAll('article, [class*="evento"], [class*="programacao"] li, .post');
    cards.forEach((card) => {
      const title = card.querySelector('h1, h2, h3, [class*="title"]')?.textContent?.trim() || '';
      const description = card.querySelector('p, [class*="excerpt"], [class*="descricao"]')?.textContent?.trim() || '';
      const link = (card.querySelector('a') as HTMLAnchorElement)?.href || '';
      const img = (card.querySelector('img') as HTMLImageElement)?.src || '';
      const dateAttr = card.querySelector('time')?.getAttribute('datetime') || '';
      if (!title || title.length < 4) return;
      events.push({
        id: generateId('ccsp', title, dateAttr),
        title,
        description,
        category: guessCategory(title, description),
        date: dateAttr || new Date().toISOString(),
        location: 'Centro Cultural São Paulo',
        address: 'R. Vergueiro, 1000 - Paraíso',
        neighborhood: 'Paraíso',
        price: 0,
        isFree: true,
        imageUrl: img,
        ticketUrl: link,
        source: 'Centro Cultural SP',
        sourceUrl: link || 'https://centrocultural.sp.gov.br/programacao/',
      });
    });
    return events;
  } catch (err) {
    console.warn('[Centro Cultural SP] fetch failed:', err);
    return [];
  }
}

// ─── Source: Pinacoteca SP ────────────────────────────────────────────────────

async function fetchPinacoteca(): Promise<Event[]> {
  try {
    const url = 'https://pinacoteca.org.br/programacao/';
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
          if (item['@type'] === 'Event' || item['@type'] === 'ExhibitionEvent') {
            const startDate = (item.startDate as string) || '';
            if (!startDate) return;
            const price = 0; // Pinacoteca is free on Saturdays and reduced other days
            events.push({
              id: generateId('pinacoteca', item.name as string, startDate),
              title: item.name as string || '',
              description: (item.description as string) || '',
              category: 'exposicao',
              date: startDate,
              endDate: (item.endDate as string) || undefined,
              location: 'Pinacoteca do Estado de São Paulo',
              address: 'Praça da Luz, 2 - Luz',
              neighborhood: 'Luz',
              price,
              isFree: false,
              imageUrl: typeof item.image === 'string' ? item.image : undefined,
              ticketUrl: item.url as string,
              source: 'Pinacoteca SP',
              sourceUrl: (item.url as string) || 'https://pinacoteca.org.br/programacao/',
            });
          }
        });
      } catch { /* skip */ }
    });

    if (events.length === 0) {
      const cards = doc.querySelectorAll('article, [class*="card"], [class*="exposicao"]');
      cards.forEach((card) => {
        const title = card.querySelector('h1, h2, h3, [class*="title"]')?.textContent?.trim() || '';
        const description = card.querySelector('p')?.textContent?.trim() || '';
        const link = (card.querySelector('a') as HTMLAnchorElement)?.href || '';
        const img = (card.querySelector('img') as HTMLImageElement)?.src || '';
        const dateAttr = card.querySelector('time')?.getAttribute('datetime') || '';
        if (!title || title.length < 4) return;
        events.push({
          id: generateId('pinacoteca', title, dateAttr),
          title, description,
          category: 'exposicao',
          date: dateAttr || new Date().toISOString(),
          location: 'Pinacoteca do Estado de São Paulo',
          address: 'Praça da Luz, 2 - Luz',
          neighborhood: 'Luz',
          price: 0, isFree: false,
          imageUrl: img, ticketUrl: link,
          source: 'Pinacoteca SP',
          sourceUrl: link || 'https://pinacoteca.org.br/programacao/',
        });
      });
    }
    return events;
  } catch (err) {
    console.warn('[Pinacoteca] fetch failed:', err);
    return [];
  }
}

// ─── Source: Instituto Moreira Salles (IMS) ───────────────────────────────────

async function fetchIMS(): Promise<Event[]> {
  try {
    const url = 'https://ims.com.br/agenda/';
    const html = await fetchWithProxy(url);
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const events: Event[] = [];

    const cards = doc.querySelectorAll('article, [class*="card"], [class*="evento"]');
    cards.forEach((card) => {
      const title = card.querySelector('h1, h2, h3, [class*="title"]')?.textContent?.trim() || '';
      const description = card.querySelector('p, [class*="excerpt"]')?.textContent?.trim() || '';
      const link = (card.querySelector('a') as HTMLAnchorElement)?.href || '';
      const img = (card.querySelector('img') as HTMLImageElement)?.src || '';
      const dateAttr = card.querySelector('time')?.getAttribute('datetime') || '';
      if (!title || title.length < 4) return;
      events.push({
        id: generateId('ims', title, dateAttr),
        title, description,
        category: guessCategory(title, description),
        date: dateAttr || new Date().toISOString(),
        location: 'IMS Paulista',
        address: 'Av. Paulista, 2424 - Bela Vista',
        neighborhood: 'Bela Vista',
        price: 0, isFree: true,
        imageUrl: img, ticketUrl: link,
        source: 'IMS',
        sourceUrl: link || 'https://ims.com.br/agenda/',
      });
    });
    return events;
  } catch (err) {
    console.warn('[IMS] fetch failed:', err);
    return [];
  }
}

// ─── Source: Memorial da América Latina ──────────────────────────────────────

async function fetchMemorialAmericaLatina(): Promise<Event[]> {
  try {
    const url = 'https://memorial.org.br/eventos/';
    const html = await fetchWithProxy(url);
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const events: Event[] = [];

    const cards = doc.querySelectorAll('article, [class*="event"], .post');
    cards.forEach((card) => {
      const title = card.querySelector('h1, h2, h3, [class*="title"]')?.textContent?.trim() || '';
      const description = card.querySelector('p, [class*="excerpt"]')?.textContent?.trim() || '';
      const link = (card.querySelector('a') as HTMLAnchorElement)?.href || '';
      const img = (card.querySelector('img') as HTMLImageElement)?.src || '';
      const dateAttr = card.querySelector('time')?.getAttribute('datetime') || '';
      if (!title || title.length < 4) return;
      events.push({
        id: generateId('memorial', title, dateAttr),
        title, description,
        category: guessCategory(title, description),
        date: dateAttr || new Date().toISOString(),
        location: 'Memorial da América Latina',
        address: 'Av. Auro Soares de Moura Andrade, 664 - Barra Funda',
        neighborhood: 'Barra Funda',
        price: 0, isFree: true,
        imageUrl: img, ticketUrl: link,
        source: 'Memorial América Latina',
        sourceUrl: link || 'https://memorial.org.br/eventos/',
      });
    });
    return events;
  } catch (err) {
    console.warn('[Memorial] fetch failed:', err);
    return [];
  }
}

// ─── Source: Ingresso.com (shows/teatro/eventos pagos) ───────────────────────

async function fetchIngressoCom(): Promise<Event[]> {
  try {
    const url = 'https://www.ingresso.com/sao-paulo/shows';
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
            if (!startDate) return;
            events.push({
              id: generateId('ingresso', item.name as string, startDate),
              title: item.name as string || '',
              description: (item.description as string) || '',
              category: guessCategory(item.name as string, (item.description as string) || ''),
              date: startDate,
              endDate: (item.endDate as string) || undefined,
              location: (locationObj?.name as string) || 'São Paulo',
              address: (locationObj?.address as Record<string, unknown>)?.streetAddress as string,
              neighborhood: '',
              price, isFree: price === 0,
              imageUrl: typeof item.image === 'string' ? item.image : undefined,
              ticketUrl: item.url as string,
              source: 'Ingresso.com',
              sourceUrl: (item.url as string) || 'https://www.ingresso.com/sao-paulo/shows',
            });
          }
        });
      } catch { /* skip */ }
    });
    return events;
  } catch (err) {
    console.warn('[Ingresso.com] fetch failed:', err);
    return [];
  }
}

// ─── Source: Ticket360 ────────────────────────────────────────────────────────

async function fetchTicket360(): Promise<Event[]> {
  try {
    const url = 'https://www.ticket360.com.br/eventos/sao-paulo';
    const html = await fetchWithProxy(url);
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const events: Event[] = [];

    const cards = doc.querySelectorAll('[class*="event"], [class*="card"], article');
    cards.forEach((card) => {
      const title = card.querySelector('h1, h2, h3, [class*="title"]')?.textContent?.trim() || '';
      const description = card.querySelector('p, [class*="description"]')?.textContent?.trim() || '';
      const link = (card.querySelector('a') as HTMLAnchorElement)?.href || '';
      const img = (card.querySelector('img') as HTMLImageElement)?.src || '';
      const dateAttr = card.querySelector('time')?.getAttribute('datetime') || '';
      const priceText = card.querySelector('[class*="price"], [class*="valor"]')?.textContent?.trim() || '';
      const price = priceText.match(/(\d+[,.]?\d*)/)?.[0] ? Number(priceText.match(/(\d+[,.]?\d*)/)![0].replace(',', '.')) : 0;
      if (!title || title.length < 4) return;
      events.push({
        id: generateId('ticket360', title, dateAttr),
        title, description,
        category: guessCategory(title, description),
        date: dateAttr || new Date().toISOString(),
        location: 'São Paulo',
        price, isFree: price === 0,
        imageUrl: img, ticketUrl: link,
        source: 'Ticket360',
        sourceUrl: link || 'https://www.ticket360.com.br/',
      });
    });
    return events;
  } catch (err) {
    console.warn('[Ticket360] fetch failed:', err);
    return [];
  }
}

// ─── Source: São Paulo Turismo (Agenda SP Turismo) ────────────────────────────

async function fetchAgendaSPTurismo(): Promise<Event[]> {
  try {
    const url = 'https://www.cidadedesaopaulo.com/eventos/';
    const html = await fetchWithProxy(url);
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const events: Event[] = [];

    const cards = doc.querySelectorAll('article, [class*="event"], [class*="card"]');
    cards.forEach((card) => {
      const title = card.querySelector('h1, h2, h3, [class*="title"]')?.textContent?.trim() || '';
      const description = card.querySelector('p, [class*="excerpt"]')?.textContent?.trim() || '';
      const link = (card.querySelector('a') as HTMLAnchorElement)?.href || '';
      const img = (card.querySelector('img') as HTMLImageElement)?.src || '';
      const dateAttr = card.querySelector('time')?.getAttribute('datetime') || '';
      if (!title || title.length < 4) return;
      events.push({
        id: generateId('sp_turismo', title, dateAttr),
        title, description,
        category: guessCategory(title, description),
        date: dateAttr || new Date().toISOString(),
        location: 'São Paulo',
        price: 0, isFree: description.toLowerCase().includes('grat') || title.toLowerCase().includes('grat'),
        imageUrl: img, ticketUrl: link,
        source: 'SP Turismo',
        sourceUrl: link || 'https://www.cidadedesaopaulo.com/eventos/',
      });
    });
    return events;
  } catch (err) {
    console.warn('[SP Turismo] fetch failed:', err);
    return [];
  }
}

// ─── Source: MIS São Paulo ────────────────────────────────────────────────────

async function fetchMIS(): Promise<Event[]> {
  try {
    const url = 'https://www.mis-sp.org.br/';
    const html = await fetchWithProxy(url);
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const events: Event[] = [];

    const cards = doc.querySelectorAll('article, [class*="event"], [class*="programacao"], [class*="agenda"]');
    cards.forEach((card) => {
      const title = card.querySelector('h1, h2, h3, [class*="title"]')?.textContent?.trim() || '';
      const description = card.querySelector('p, [class*="excerpt"]')?.textContent?.trim() || '';
      const link = (card.querySelector('a') as HTMLAnchorElement)?.href || '';
      const img = (card.querySelector('img') as HTMLImageElement)?.src || '';
      const dateAttr = card.querySelector('time')?.getAttribute('datetime') || '';
      if (!title || title.length < 4) return;
      events.push({
        id: generateId('mis', title, dateAttr),
        title, description,
        category: guessCategory(title, description),
        date: dateAttr || new Date().toISOString(),
        location: 'MIS - Museu da Imagem e do Som',
        address: 'Av. Europa, 158 - Jardim Europa',
        neighborhood: 'Jardim Europa',
        price: 0, isFree: false,
        imageUrl: img, ticketUrl: link,
        source: 'MIS SP',
        sourceUrl: link || 'https://www.mis-sp.org.br/',
      });
    });
    return events;
  } catch (err) {
    console.warn('[MIS] fetch failed:', err);
    return [];
  }
}

// ─── Mock/Fallback data (ensures app always has content) ─────────────────────
// This rich dataset guarantees the app always shows events, especially free ones.
// It covers SESC units, cultural centers, museums, parks, and event venues in SP.

function generateMockEvents(): Event[] {
  const today = new Date();
  const m = today.getMonth();
  const y = today.getFullYear();
  const d = (day: number, hour = 0, min = 0) => new Date(y, m, day, hour, min).toISOString();
  const dn = (day: number, hour = 0, min = 0) => new Date(y, m + 1, day, hour, min).toISOString();

  const mockData: Omit<Event, 'id'>[] = [

    // ──────── SESC SP — múltiplas unidades ────────────────────────────────────
    {
      title: 'SESC Pinheiros — Festival de Jazz',
      description: 'Três dias de jazz com artistas nacionais e internacionais. Workshops, masterclasses e jam sessions abertas ao público. Entrada gratuita.',
      category: 'musica', date: d(3, 20), endDate: d(5, 23), time: '20:00',
      location: 'SESC Pinheiros', address: 'Rua Paes Leme, 195', neighborhood: 'Pinheiros',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?w=800&q=80',
      ticketUrl: 'https://www.sescsp.org.br/agenda/', source: 'SESC SP', sourceUrl: 'https://www.sescsp.org.br/agenda/', featured: true,
    },
    {
      title: 'SESC Pompeia — Cinema na Varanda',
      description: 'Sessões de cinema gratuito aos fins de semana na varanda do SESC Pompeia. Filmes nacionais e clássicos do cinema mundial. Entrada franca.',
      category: 'cinema', date: d(6, 15), endDate: d(27, 18), time: '15:00',
      location: 'SESC Pompeia', address: 'Rua Clélia, 93', neighborhood: 'Pompeia',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=800&q=80',
      ticketUrl: 'https://www.sescsp.org.br/agenda/', source: 'SESC SP', sourceUrl: 'https://www.sescsp.org.br/agenda/',
    },
    {
      title: 'SESC Consolação — Espetáculo de Dança Contemporânea',
      description: 'Apresentação gratuita do grupo de dança contemporânea Nave em cartaz por dois finais de semana. Obra que mistura teatro e movimento.',
      category: 'danca', date: d(10, 19, 30), endDate: d(11, 18), time: '19:30',
      location: 'SESC Consolação', address: 'R. Dr. Vila Nova, 245', neighborhood: 'Consolação',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1518611507888-3e15cce98b21?w=800&q=80',
      ticketUrl: 'https://www.sescsp.org.br/agenda/', source: 'SESC SP', sourceUrl: 'https://www.sescsp.org.br/agenda/',
    },
    {
      title: 'SESC Belenzinho — Teatro para Crianças: "As Aventuras de Pinóquio"',
      description: 'Espetáculo infantil gratuito com reserva antecipada. Para crianças de 4 a 12 anos. Duração 50 minutos. Sábados e domingos às 15h.',
      category: 'infantil', date: d(7, 15), endDate: d(28, 17), time: '15:00',
      location: 'SESC Belenzinho', address: 'R. Padre Adelino, 1000', neighborhood: 'Belenzinho',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?w=800&q=80',
      ticketUrl: 'https://www.sescsp.org.br/agenda/', source: 'SESC SP', sourceUrl: 'https://www.sescsp.org.br/agenda/',
    },
    {
      title: 'SESC Vila Mariana — Show de MPB: Canto do Sertão',
      description: 'Show gratuito com os melhores ritmos do Nordeste: forró, baião, xote e repente. Banda completa com 8 músicos. Não perca!',
      category: 'musica', date: d(13, 18, 30), time: '18:30',
      location: 'SESC Vila Mariana', address: 'R. Pelotas, 141', neighborhood: 'Vila Mariana',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800&q=80',
      ticketUrl: 'https://www.sescsp.org.br/agenda/', source: 'SESC SP', sourceUrl: 'https://www.sescsp.org.br/agenda/',
    },
    {
      title: 'SESC Santana — Exposição Fotográfica: "Retratos da Periferia"',
      description: 'Exposição gratuita com 80 fotografias que documentam a vida e a cultura das periferias de São Paulo. Visitação de terça a domingo, 10h–20h.',
      category: 'exposicao', date: d(1), endDate: d(30), time: '10:00',
      location: 'SESC Santana', address: 'Av. Luiz Dumont Villares, 579', neighborhood: 'Santana',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1502635385003-ee1e6a1a742d?w=800&q=80',
      ticketUrl: 'https://www.sescsp.org.br/agenda/', source: 'SESC SP', sourceUrl: 'https://www.sescsp.org.br/agenda/',
    },
    {
      title: 'SESC Ipiranga — Oficina de Teatro para Adultos',
      description: 'Oficina gratuita de iniciação ao teatro para adultos sem experiência prévia. 4 sábados seguidos, das 10h às 13h. Vagas limitadas.',
      category: 'teatro', date: d(8, 10), endDate: d(29, 13), time: '10:00',
      location: 'SESC Ipiranga', address: 'R. Bom Pastor, 822', neighborhood: 'Ipiranga',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1503095396549-807759245b35?w=800&q=80',
      ticketUrl: 'https://www.sescsp.org.br/agenda/', source: 'SESC SP', sourceUrl: 'https://www.sescsp.org.br/agenda/',
    },
    {
      title: 'SESC Santo André — Feira do Conhecimento',
      description: 'Feira de livros usados, troca de saberes, palestras abertas e bate-papo com autores. Entrada gratuita. Ótimo para toda a família.',
      category: 'literatura', date: d(20, 10), endDate: d(21, 18), time: '10:00',
      location: 'SESC Santo André', address: 'R. Tamarutaca, 302 — Santo André', neighborhood: 'Santo André',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=800&q=80',
      ticketUrl: 'https://www.sescsp.org.br/agenda/', source: 'SESC SP', sourceUrl: 'https://www.sescsp.org.br/agenda/',
    },
    {
      title: 'SESC Pompeia — Feirinha Artesanal',
      description: 'Feira de artesanato com mais de 50 expositores de design, moda, gastronomia e arte independente. Entrada gratuita aos sábados e domingos.',
      category: 'cultura', date: d(14, 10), endDate: d(14, 18), time: '10:00',
      location: 'SESC Pompeia', address: 'Rua Clélia, 93', neighborhood: 'Pompeia',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=800&q=80',
      ticketUrl: 'https://www.sescsp.org.br/agenda/', source: 'SESC SP', sourceUrl: 'https://www.sescsp.org.br/agenda/',
    },
    {
      title: 'SESC Pinheiros — Yoga no Terraço (Gratuito)',
      description: 'Aulas de yoga abertas ao público todas as manhãs no terraço do SESC Pinheiros com vista para a cidade. Leve seu tapetinho.',
      category: 'esporte', date: d(1, 7), endDate: d(30, 8), time: '07:00',
      location: 'SESC Pinheiros', address: 'Rua Paes Leme, 195', neighborhood: 'Pinheiros',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1545389336-cf090694435e?w=800&q=80',
      ticketUrl: 'https://www.sescsp.org.br/agenda/', source: 'SESC SP', sourceUrl: 'https://www.sescsp.org.br/agenda/',
    },
    {
      title: 'SESC Interlagos — Sarau de Poesia Negra',
      description: 'Noite de sarau com poetas e escritores negros do ABC e Grande SP. Música ao vivo, slam de poesia e exposição fotográfica. Entrada gratuita.',
      category: 'literatura', date: d(17, 19), time: '19:00',
      location: 'SESC Interlagos', address: 'Av. Manuel Alves Soares, 1100', neighborhood: 'Interlagos',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1455849318743-b2233052fcff?w=800&q=80',
      ticketUrl: 'https://www.sescsp.org.br/agenda/', source: 'SESC SP', sourceUrl: 'https://www.sescsp.org.br/agenda/',
    },

    // ──────── Centro Cultural São Paulo (CCSP) ────────────────────────────────
    {
      title: 'CCSP — Exposição: "Arte e Resistência"',
      description: 'Exposição coletiva com obras de 30 artistas emergentes que exploram identidade, política e diversidade. Entrada gratuita. Terça a domingo.',
      category: 'exposicao', date: d(1), endDate: d(30),
      location: 'Centro Cultural São Paulo', address: 'R. Vergueiro, 1000 — Paraíso', neighborhood: 'Paraíso',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1580060839134-75a5edca2e99?w=800&q=80',
      ticketUrl: 'https://centrocultural.sp.gov.br', source: 'Centro Cultural SP', sourceUrl: 'https://centrocultural.sp.gov.br',
    },
    {
      title: 'CCSP — Concerto de Câmara Gratuito',
      description: 'Concerto da Orquestra de Câmara Municipal com obras de Bach, Mozart e compositores brasileiros. Sessão única. Entrada franca.',
      category: 'musica', date: d(11, 17), time: '17:00',
      location: 'Centro Cultural São Paulo', address: 'R. Vergueiro, 1000 — Paraíso', neighborhood: 'Paraíso',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=800&q=80',
      ticketUrl: 'https://centrocultural.sp.gov.br', source: 'Centro Cultural SP', sourceUrl: 'https://centrocultural.sp.gov.br',
    },
    {
      title: 'CCSP — Peça de Teatro: "O Encontro"',
      description: 'Espetáculo teatral gratuito da Cia Aberta de Teatro. Uma história sobre solidão e reencantamento da vida cotidiana. Sextas e sábados.',
      category: 'teatro', date: d(5, 20), endDate: d(26, 21), time: '20:00',
      location: 'Centro Cultural São Paulo', address: 'R. Vergueiro, 1000 — Paraíso', neighborhood: 'Paraíso',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1508345228704-935cc84bf5e2?w=800&q=80',
      ticketUrl: 'https://centrocultural.sp.gov.br', source: 'Centro Cultural SP', sourceUrl: 'https://centrocultural.sp.gov.br',
    },

    // ──────── Museus e Instituições Culturais ─────────────────────────────────
    {
      title: 'MASP — Exposição: "Memórias de São Paulo"',
      description: 'Retrospectiva fotográfica com 200 imagens históricas da cidade de São Paulo desde 1900. Gratuito às terças, R$60 demais dias.',
      category: 'exposicao', date: d(1), endDate: dn(30),
      location: 'MASP', address: 'Av. Paulista, 1578', neighborhood: 'Bela Vista',
      price: 60, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1580060839134-75a5edca2e99?w=800&q=80',
      ticketUrl: 'https://masp.org.br', source: 'MASP', sourceUrl: 'https://masp.org.br', featured: true,
    },
    {
      title: 'Pinacoteca — "Brasil Moderno" — Entrada Gratuita Sábados',
      description: 'Acervo permanente com mais de 10.000 obras da arte brasileira dos séculos XIX e XX. Entrada gratuita aos sábados. R$20 demais dias.',
      category: 'exposicao', date: d(1), endDate: dn(30),
      location: 'Pinacoteca do Estado', address: 'Praça da Luz, 2 — Luz', neighborhood: 'Luz',
      price: 20, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1518998053901-5348d3961a04?w=800&q=80',
      ticketUrl: 'https://pinacoteca.org.br', source: 'Pinacoteca SP', sourceUrl: 'https://pinacoteca.org.br',
    },
    {
      title: 'IMS Paulista — "Sebastião Salgado: Amazônia"',
      description: 'Mostra fotográfica com imagens inéditas de Sebastião Salgado sobre a floresta Amazônica e seus povos. Entrada gratuita.',
      category: 'exposicao', date: d(1), endDate: dn(30),
      location: 'IMS Paulista', address: 'Av. Paulista, 2424', neighborhood: 'Bela Vista',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=800&q=80',
      ticketUrl: 'https://ims.com.br', source: 'IMS', sourceUrl: 'https://ims.com.br',
    },
    {
      title: 'Memorial da América Latina — Cultura Andina',
      description: 'Exposição permanente sobre culturas andinas, com peças arqueológicas, têxteis e mapas históricos. Entrada gratuita de terça a domingo.',
      category: 'cultura', date: d(1), endDate: dn(30),
      location: 'Memorial da América Latina', address: 'Av. Auro Soares de Moura Andrade, 664', neighborhood: 'Barra Funda',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=800&q=80',
      ticketUrl: 'https://memorial.org.br', source: 'Memorial América Latina', sourceUrl: 'https://memorial.org.br',
    },
    {
      title: 'MIS SP — "Era Digital: 30 Anos de Internet"',
      description: 'Exposição interativa sobre a história da internet e a revolução digital. Instalações imersivas, acervo fotográfico e vídeos históricos.',
      category: 'tecnologia', date: d(1), endDate: dn(30),
      location: 'MIS - Museu da Imagem e do Som', address: 'Av. Europa, 158', neighborhood: 'Jardim Europa',
      price: 25, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=800&q=80',
      ticketUrl: 'https://www.mis-sp.org.br/', source: 'MIS SP', sourceUrl: 'https://www.mis-sp.org.br/',
    },
    {
      title: 'Museu Afro Brasil — Herança Africana na Cultura Paulistana',
      description: 'Exposição com mais de 6.000 peças que contam a história da cultura africana e afro-brasileira. Entrada gratuita aos sábados.',
      category: 'cultura', date: d(1), endDate: dn(30),
      location: 'Museu Afro Brasil', address: 'Av. Pedro Álvares Cabral, 10001 — Ibirapuera', neighborhood: 'Vila Mariana',
      price: 10, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1534330207526-8e81f10ec6fc?w=800&q=80',
      ticketUrl: 'https://museuafroBrasil.org.br', source: 'Museu Afro Brasil', sourceUrl: 'https://museuafrobrasil.org.br',
    },

    // ──────── Parques e Espaços Públicos ──────────────────────────────────────
    {
      title: 'Parque Ibirapuera — Feira Gastronômica',
      description: 'Mais de 80 expositores: comidas regionais, food trucks, chefs convidados, cervejas artesanais e muito mais. Entrada gratuita.',
      category: 'gastronomia', date: d(15, 10), endDate: d(16, 20), time: '10:00',
      location: 'Parque Ibirapuera', address: 'Av. Pedro Álvares Cabral, s/n', neighborhood: 'Vila Mariana',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800&q=80',
      ticketUrl: 'https://ibirapuera.org', source: 'Parque Ibirapuera', sourceUrl: 'https://ibirapuera.org',
    },
    {
      title: 'Parque Estadual da Cantareira — Trilha Guiada Gratuita',
      description: 'Caminhada ecológica gratuita com guias ambientais pelo maior parque urbano do mundo. Saída às 8h da portaria Tremembé. Vagas limitadas.',
      category: 'esporte', date: d(22, 8), time: '08:00',
      location: 'Parque Estadual da Cantareira', address: 'Av. Edu Chaves, s/n — Tremembé', neighborhood: 'Tremembé',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=800&q=80',
      ticketUrl: 'https://fflorestal.sp.gov.br', source: 'Parques SP', sourceUrl: 'https://fflorestal.sp.gov.br',
    },
    {
      title: 'Ciclovia da Paulista — Domingo Sem Carro',
      description: 'Av. Paulista fechada para carros todos os domingos. Ciclismo, caminhada, patins e muito mais. Barraquinhas, artistas de rua e atividades físicas.',
      category: 'esporte', date: d(5, 7), endDate: d(26, 16), time: '07:00',
      location: 'Avenida Paulista', address: 'Av. Paulista, s/n', neighborhood: 'Bela Vista',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1558618047-3c8c76ca7d13?w=800&q=80',
      ticketUrl: 'https://www.prefeitura.sp.gov.br', source: 'Prefeitura SP', sourceUrl: 'https://www.prefeitura.sp.gov.br',
    },

    // ──────── Shows e Teatro Pagos ─────────────────────────────────────────────
    {
      title: 'Show: Titãs 45 Anos — Allianz Parque',
      description: 'A banda de rock mais icônica do Brasil celebra 45 anos com um show histórico no Allianz Parque. Clássicos como Cabeça Dinossauro ao vivo.',
      category: 'musica', date: d(18, 21), time: '21:00',
      location: 'Allianz Parque', address: 'Av. Francisco Matarazzo, 1705', neighborhood: 'Água Branca',
      price: 150, priceMax: 450, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=800&q=80',
      ticketUrl: 'https://www.sympla.com.br', source: 'Sympla', sourceUrl: 'https://www.sympla.com.br', featured: true,
    },
    {
      title: 'Peça: "Hamlet" — Teatro Alfa',
      description: 'Montagem contemporânea do clássico de Shakespeare com elenco renomado. Direção de Bia Lessa. De quinta a domingo.',
      category: 'teatro', date: d(4, 20), endDate: d(25, 21), time: '20:00',
      location: 'Teatro Alfa', address: 'R. Bento Branco de Andrade Filho, 722', neighborhood: 'Santo Amaro',
      price: 80, priceMax: 160, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1503095396549-807759245b35?w=800&q=80',
      ticketUrl: 'https://www.sympla.com.br', source: 'Sympla', sourceUrl: 'https://www.sympla.com.br',
    },
    {
      title: 'Ballet: "Lago dos Cisnes" — Teatro Municipal',
      description: 'O clássico de Tchaikovsky pelo Ballet da Cidade de São Paulo. Ingressos com 50% de desconto para estudantes e idosos.',
      category: 'danca', date: d(16, 20, 30), endDate: d(19, 21), time: '20:30',
      location: 'Teatro Municipal de São Paulo', address: 'Praça Ramos de Azevedo, s/n', neighborhood: 'Centro',
      price: 80, priceMax: 300, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1518611507888-3e15cce98b21?w=800&q=80',
      ticketUrl: 'https://theatromunicipal.org.br', source: 'Teatro Municipal', sourceUrl: 'https://theatromunicipal.org.br',
    },
    {
      title: 'Show: Fagner & Zé Ramalho — Espaço das Américas',
      description: 'Os ícones do Nordeste juntos no palco em noite histórica. Repertório com clássicos de ambos os cantores e músicas inéditas.',
      category: 'musica', date: d(24, 20), time: '20:00',
      location: 'Espaço das Américas', address: 'R. Tagipuru, 795', neighborhood: 'Barra Funda',
      price: 120, priceMax: 280, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800&q=80',
      ticketUrl: 'https://www.sympla.com.br', source: 'Sympla', sourceUrl: 'https://www.sympla.com.br',
    },

    // ──────── Tecnologia e Negócios ───────────────────────────────────────────
    {
      title: 'SP Tech Summit — Fórum de Inovação',
      description: 'Maior fórum de tecnologia e startups de SP. Palestras com CEO\u2019s de unicórnios brasileiros, hackathon aberto e networking. Acesso gratuito.',
      category: 'tecnologia', date: d(20, 9), endDate: d(21, 18), time: '09:00',
      location: 'Expo Center Norte', address: 'Rua José Bernardo Pinto, 333', neighborhood: 'Vila Guilherme',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=800&q=80',
      ticketUrl: 'https://sympla.com.br', source: 'Sympla', sourceUrl: 'https://sympla.com.br', featured: true,
    },

    // ──────── Gastronomia ─────────────────────────────────────────────────────
    {
      title: 'Mercado Municipal — Noite Temática Italiana',
      description: 'Uma noite especial no Mercadão com pratos típicos italianos, vinhos, musica ao vivo e apresentações de chefs renomados. Acesso gratuito.',
      category: 'gastronomia', date: d(12, 18), time: '18:00',
      location: 'Mercado Municipal de SP', address: 'R. da Cantareira, 306 — Centro', neighborhood: 'Centro',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&q=80',
      ticketUrl: 'https://mercadaomunicipal.com.br', source: 'Mercadão SP', sourceUrl: 'https://mercadaomunicipal.com.br',
    },
    {
      title: 'Festival Gourmet — Bairro da Liberdade',
      description: 'Festival de culinária oriental com yakisoba, sushi, ramen, guiozá e muito mais no coração do bairro oriental de SP. Entrada gratuita.',
      category: 'gastronomia', date: d(9, 11), endDate: d(10, 20), time: '11:00',
      location: 'Praça da Liberdade', address: 'Praça da Liberdade, s/n', neighborhood: 'Liberdade',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1569050467447-ce54b3bbc37d?w=800&q=80',
      ticketUrl: 'https://sympla.com.br', source: 'Sympla', sourceUrl: 'https://sympla.com.br',
    },

    // ──────── Aviação ─────────────────────────────────────────────────────────
    {
      title: 'Expo Aviação — Campo de Marte',
      description: 'Exposição de aeronaves históricas e modernas, simuladores de voo, voos panorâmicos de helicóptero e apresentações acrobáticas. Um sonho para aviadores!',
      category: 'aviacao', date: d(19, 9), endDate: d(20, 18), time: '09:00',
      location: 'Aeroporto Campo de Marte', address: 'Av. Santos Dumont, 1979', neighborhood: 'Santana',
      price: 30, priceMax: 200, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=800&q=80',
      ticketUrl: 'https://sympla.com.br', source: 'Sympla', sourceUrl: 'https://sympla.com.br',
    },
    {
      title: 'Museu TAM — Visita Gratuita com Guia',
      description: 'Visita guiada gratuita ao maior acervo de aeronáutica civil da América Latina. Aeronaves históricas, motores, uniformes e história da aviação brasileira.',
      category: 'aviacao', date: d(1), endDate: d(30),
      location: 'Museu TAM', address: 'Av. Santos Dumont, 800 — Faria Lima', neighborhood: 'Faria Lima',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1583202842046-c90e3fc59c0c?w=800&q=80',
      ticketUrl: 'https://museutan.tam.com.br', source: 'Museu TAM', sourceUrl: 'https://www.tam.com.br',
    },

    // ──────── Esporte ─────────────────────────────────────────────────────────
    {
      title: 'Corrida SP — Maratona da Cidade',
      description: 'A maior corrida de rua de SP com percursos de 5km, 10km, 21km e 42km. Circuito passa pela Paulista, Ibirapuera e centro histórico.',
      category: 'esporte', date: d(27, 6), time: '06:00',
      location: 'Av. Paulista', address: 'Av. Paulista, s/n', neighborhood: 'Bela Vista',
      price: 80, priceMax: 180, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1452626038306-9aae5e071b52?w=800&q=80',
      ticketUrl: 'https://sympla.com.br', source: 'Sympla', sourceUrl: 'https://sympla.com.br',
    },
    {
      title: 'Futebol de Base — Arena Corinthians (Gratuito)',
      description: 'Jogos do campeonato paulista sub-17 e sub-20 abertos ao público. Entrada gratuita mediante retirada de ingresso antecipado.',
      category: 'esporte', date: d(8, 15), time: '15:00',
      location: 'Neo Química Arena', address: 'Av. Miguel Ignácio Curi, 111', neighborhood: 'Itaquera',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=800&q=80',
      ticketUrl: 'https://www.corinthians.com.br', source: 'Corinthians', sourceUrl: 'https://www.corinthians.com.br',
    },

    // ──────── Infantil ────────────────────────────────────────────────────────
    {
      title: 'Museu Catavento — Ciência para Crianças',
      description: 'Museu interativo de ciências com mais de 250 experimentos. Crianças aprendem sobre física, química e astronomia brincando. Entrada acessível.',
      category: 'infantil', date: d(1), endDate: dn(30),
      location: 'Museu Catavento', address: 'Av. Mercúrio, s/n — Brás', neighborhood: 'Brás',
      price: 10, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?w=800&q=80',
      ticketUrl: 'https://museucatavento.org.br', source: 'Museu Catavento', sourceUrl: 'https://museucatavento.org.br',
    },
    {
      title: 'Parque Villa-Lobos — Festa das Crianças',
      description: 'Programação especial com teatro de rua, contação de histórias, brinquedos infláveis e oficinas de pintura. Tudo gratuito!',
      category: 'infantil', date: d(12, 10), endDate: d(12, 17), time: '10:00',
      location: 'Parque Villa-Lobos', address: 'Av. Prof. Fonseca Rodrigues, 2001', neighborhood: 'Alto de Pinheiros',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?w=800&q=80',
      ticketUrl: 'https://parquevillalobo.sp.gov.br', source: 'Parques SP', sourceUrl: 'https://parquevillalobo.sp.gov.br',
    },

    // ──────── Festas e Cultura ────────────────────────────────────────────────
    {
      title: 'Bloco Maluco Beleza — Rua Augusta',
      description: 'Bloco de carnaval fora de época com marchinha, frevo e axé no coração de SP. Fantasia obrigatória. Concentração a partir das 14h.',
      category: 'festa', date: d(25, 14), time: '14:00',
      location: 'Rua Augusta', address: 'Rua Augusta, s/n', neighborhood: 'Consolação',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1551818255-e6e10975bc17?w=800&q=80',
      ticketUrl: 'https://sympla.com.br', source: 'Sympla', sourceUrl: 'https://sympla.com.br',
    },
    {
      title: 'Festa Junina Tradicional — Parque do Trote',
      description: 'Festa junina com quadrilha, forró ao vivo, comidas típicas, pescaria e bingão. Entrada gratuita para toda a família.',
      category: 'festa', date: d(14, 14), endDate: d(15, 22), time: '14:00',
      location: 'Parque do Trote', address: 'R. José Getúlio, 420 — Cambuci', neighborhood: 'Cambuci',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1504701954957-2010ec3bcec1?w=800&q=80',
      ticketUrl: 'https://sympla.com.br', source: 'Sympla', sourceUrl: 'https://sympla.com.br',
    },
    {
      title: 'Virada Cultural de São Paulo',
      description: '24 horas ininterruptas de cultura gratuita espalhadas por toda São Paulo. Mais de 3.000 atrações em palcos, ruas, museus e centros culturais.',
      category: 'cultura', date: d(23, 18), endDate: d(24, 18), time: '18:00',
      location: 'Toda São Paulo', address: 'Diversas localizações', neighborhood: 'Centro e Bairros',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=800&q=80',
      ticketUrl: 'https://viradacultural.prefeitura.sp.gov.br', source: 'Prefeitura SP', sourceUrl: 'https://viradacultural.prefeitura.sp.gov.br', featured: true,
    },

    // ──────── Cinema ──────────────────────────────────────────────────────────
    {
      title: 'Cine Sesc — Sessão Gratuita: Filmes Brasileiros',
      description: 'Ciclo de cinema nacional com longas-metragens premiados. Sessões gratuitas às terças às 15h. Debate com diretores após a sessão.',
      category: 'cinema', date: d(1, 15), endDate: d(29, 17), time: '15:00',
      location: 'SESC Consolação', address: 'R. Dr. Vila Nova, 245', neighborhood: 'Consolação',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=800&q=80',
      ticketUrl: 'https://www.sescsp.org.br/agenda/', source: 'SESC SP', sourceUrl: 'https://www.sescsp.org.br/agenda/',
    },

    // ──────── Próximo Mês ─────────────────────────────────────────────────────
    {
      title: 'Bienal do Livro de São Paulo',
      description: 'A maior feira do livro da América Latina. Mais de 3.000 títulos, autores internacionais, lançamentos exclusivos e atividades culturais.',
      category: 'literatura', date: dn(3, 10), endDate: dn(13, 21), time: '10:00',
      location: 'Pavilhão da Bienal — Parque Ibirapuera', address: 'Portão 3 — Parque Ibirapuera', neighborhood: 'Vila Mariana',
      price: 30, priceMax: 60, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1507842217343-583bb7270b66?w=800&q=80',
      ticketUrl: 'https://bienaldolivro.com.br', source: 'Bienal do Livro', sourceUrl: 'https://bienaldolivro.com.br', featured: true,
    },
    {
      title: 'SESC Pompeia — Rock in Sesc (Gratuito)',
      description: 'Festival de rock com 10 bandas independentes paulistanas. Dois palcos, praça de alimentação e feira de discos de vinil. Entrada gratuita.',
      category: 'musica', date: dn(5, 17), endDate: dn(6, 22), time: '17:00',
      location: 'SESC Pompeia', address: 'Rua Clélia, 93', neighborhood: 'Pompeia',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=800&q=80',
      ticketUrl: 'https://www.sescsp.org.br/agenda/', source: 'SESC SP', sourceUrl: 'https://www.sescsp.org.br/agenda/',
    },
    {
      title: 'CCSP — Noite de Slam Poetry',
      description: 'Festival de slam com competição aberta ao público. Inscrições para participar no local. Entrada gratuita para plateia. A partir das 19h.',
      category: 'literatura', date: dn(8, 19), time: '19:00',
      location: 'Centro Cultural São Paulo', address: 'R. Vergueiro, 1000', neighborhood: 'Paraíso',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1455849318743-b2233052fcff?w=800&q=80',
      ticketUrl: 'https://centrocultural.sp.gov.br', source: 'Centro Cultural SP', sourceUrl: 'https://centrocultural.sp.gov.br',
    },
    {
      title: 'São Paulo Fashion Week',
      description: 'A semana de moda mais importante da América Latina. Desfiles, showrooms e pop-ups exclusivos. Acesso público ao Mercado Fashion.',
      category: 'cultura', date: dn(10, 18), endDate: dn(15, 23), time: '18:00',
      location: 'Complexo Geraldo de Alckmin', address: 'R. Rego Freitas, 454', neighborhood: 'República',
      price: 0, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80',
      ticketUrl: 'https://spfw.com.br', source: 'SPFW', sourceUrl: 'https://spfw.com.br', featured: true,
    },
    {
      title: 'Mostra Internacional de Cinema de São Paulo',
      description: 'A Mostra SP traz filmes de mais de 60 países. Competição, retrospectivas e sessões especiais em salas de cinema por todo o estado.',
      category: 'cinema', date: dn(18, 14), endDate: dn(31, 22), time: '14:00',
      location: 'Multiplas salas — São Paulo', address: 'Diversas localizações', neighborhood: 'Centro e Bairros',
      price: 25, priceMax: 50, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=800&q=80',
      ticketUrl: 'https://mostra.org', source: 'Mostra SP', sourceUrl: 'https://mostra.org',
    },
    {
      title: 'SESC Belenzinho — Circo Contemporâneo',
      description: 'Espetáculo circense gratuito com acrobatas, malabaristas e contorcionistas de todo o Brasil. Para toda a família. Domingo às 16h.',
      category: 'cultura', date: dn(12, 16), time: '16:00',
      location: 'SESC Belenzinho', address: 'R. Padre Adelino, 1000', neighborhood: 'Belenzinho',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=800&q=80',
      ticketUrl: 'https://www.sescsp.org.br/agenda/', source: 'SESC SP', sourceUrl: 'https://www.sescsp.org.br/agenda/',
    },
    {
      title: 'Festival Internacional de Teatro — SP',
      description: 'Companhias de teatro do Brasil, Argentina, França e Portugal em cartaz simultâneo por toda São Paulo. Espetáculos gratuitos e pagos.',
      category: 'teatro', date: dn(15, 19), endDate: dn(25, 22), time: '19:00',
      location: 'Diversas Localizações', address: 'Teatros e centros culturais de SP', neighborhood: 'Toda SP',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1508345228704-935cc84bf5e2?w=800&q=80',
      ticketUrl: 'https://centrocultural.sp.gov.br', source: 'Centro Cultural SP', sourceUrl: 'https://centrocultural.sp.gov.br', featured: true,
    },
  ];
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

  // Fetch from ALL sources in parallel — failures are silently swallowed
  const [sympla, eventbrite, sampaCultura, prefeitura, g1, catracaLivre, balada,
         sesc, ccsp, pinacoteca, ims, memorial, ingresso, ticket360, spTurismo, mis] =
    await Promise.allSettled([
      fetchSympla(fromDate, toDate),
      fetchEventbrite(fromDate, toDate),
      fetchSampaCultura(),
      fetchAgendaCulturalSP(),
      fetchG1SPEventos(),
      fetchCatracaLivre(),
      fetchBaladaSP(),
      fetchSescSP(),
      fetchCentroCulturalSP(),
      fetchPinacoteca(),
      fetchIMS(),
      fetchMemorialAmericaLatina(),
      fetchIngressoCom(),
      fetchTicket360(),
      fetchAgendaSPTurismo(),
      fetchMIS(),
    ]);

  const realEvents: Event[] = [
    ...(sympla.status === 'fulfilled' ? sympla.value : []),
    ...(eventbrite.status === 'fulfilled' ? eventbrite.value : []),
    ...(sampaCultura.status === 'fulfilled' ? sampaCultura.value : []),
    ...(prefeitura.status === 'fulfilled' ? prefeitura.value : []),
    ...(g1.status === 'fulfilled' ? g1.value : []),
    ...(catracaLivre.status === 'fulfilled' ? catracaLivre.value : []),
    ...(balada.status === 'fulfilled' ? balada.value : []),
    ...(sesc.status === 'fulfilled' ? sesc.value : []),
    ...(ccsp.status === 'fulfilled' ? ccsp.value : []),
    ...(pinacoteca.status === 'fulfilled' ? pinacoteca.value : []),
    ...(ims.status === 'fulfilled' ? ims.value : []),
    ...(memorial.status === 'fulfilled' ? memorial.value : []),
    ...(ingresso.status === 'fulfilled' ? ingresso.value : []),
    ...(ticket360.status === 'fulfilled' ? ticket360.value : []),
    ...(spTurismo.status === 'fulfilled' ? spTurismo.value : []),
    ...(mis.status === 'fulfilled' ? mis.value : []),
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

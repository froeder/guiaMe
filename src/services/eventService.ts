import type { Event, EventCategory } from '../types/event';
import { startOfMonth, endOfMonth, addMonths, addDays, format, parseISO } from 'date-fns';

const CACHE_KEY = 'sp_eventos_cache_v7';
const CACHE_TIMESTAMP_KEY = 'sp_eventos_cache_ts_v7';
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
  const pad = (n: number) => String(n).padStart(2, '0');

  // Formata data local 'YYYY-MM-DDTHH:mm:00' para evitar qualquer deslocamento UTC
  const d = (day: number, hour = 0, min = 0) =>
    `${y}-${pad(m + 1)}-${pad(day)}T${pad(hour)}:${pad(min)}:00`;

  const dn = (day: number, hour = 0, min = 0) => {
    const nextM = (m + 1) % 12;
    const nextY = m + 1 >= 12 ? y + 1 : y;
    return `${nextY}-${pad(nextM + 1)}-${pad(day)}T${pad(hour)}:${pad(min)}:00`;
  };

  const mockData: Omit<Event, 'id'>[] = [
    // ══════════════════════════════════════════════════════════════════════════
    // 🎃 ESPECIAL DIA DAS BRUXAS / HALLOWEEN & DIA DO SACI (31 DE OUTUBRO) 🎃
    // ══════════════════════════════════════════════════════════════════════════
    {
      title: 'Halloween da Audio: O Grande Baile dos Monstros',
      description: 'A maior festa à fantasia de Halloween de São Paulo! Concurso com premiação de R$ 10.000 para as melhores caracterizações, 3 pistas simultâneas (Rock, Pop, Eletrônico), labirinto assombrado com atores e open bar temático no mezanino.',
      category: 'festa', date: dn(31, 22), time: '22:00',
      location: 'Audio Club', address: 'Av. Francisco Matarazzo, 694 — Barra Funda', neighborhood: 'Barra Funda',
      price: 80, priceMax: 220, isFree: false, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=800&q=80',
      ticketUrl: 'https://www.audiosp.com.br/', source: 'Audio SP', sourceUrl: 'https://www.audiosp.com.br/',
      tags: ['halloween', 'dia das bruxas', 'fantasia', 'balada', 'audio', 'barra funda'],
    },
    {
      title: 'Madame Underground Club: A Lendária Noite de Halloween Gótica',
      description: 'O clube gótico mais lendário da América Latina celebra a Noite de Halloween no casarão histórico da Bela Vista. Decoração fúnebre exclusiva, poções no bar, DJs de post-punk, darkwave e gothic rock, e concurso de fantasias dark.',
      category: 'festa', date: dn(31, 23), time: '23:00',
      location: 'Madame Underground Club', address: 'Rua Conselheiro Ramalho, 873 — Bela Vista', neighborhood: 'Bela Vista',
      price: 45, priceMax: 90, isFree: false, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&q=80',
      ticketUrl: 'https://madameclub.com.br', source: 'Madame Club', sourceUrl: 'https://madameclub.com.br',
      tags: ['halloween', 'dia das bruxas', 'madame', 'goth', 'bela vista', 'festa'],
    },
    {
      title: 'Candlelight Halloween: Trilhas Sonoras de Terror à Luz de Velas',
      description: 'Concerto à luz de velas intimista com quarteto de cordas executando trilhas inesquecíveis: Halloween (John Carpenter), O Exorcista, Tubarão, Stranger Things, Psicose, Danse Macabre e Thriller sob a luz de 5.000 velas.',
      category: 'musica', date: dn(31, 19, 30), time: '19:30',
      location: 'Teatro Bradesco', address: 'Rua Palestra Itália, 500 — Bourbon Shopping', neighborhood: 'Perdizes',
      price: 75, priceMax: 190, isFree: false, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1507676184212-d03ab07a01bf?w=800&q=80',
      ticketUrl: 'https://feverup.com/sao-paulo', source: 'Candlelight', sourceUrl: 'https://feverup.com/sao-paulo',
      tags: ['halloween', 'candlelight', 'concerto', 'trilhas sonoras', 'terror', 'musica'],
    },
    {
      title: 'MIS SP: Maratona Cine Horror Especial Madrugada de Halloween',
      description: 'Noite inteira com clássicos do terror nas salas do Museu da Imagem e do Som. Exibição de O Iluminado, Suspiria e A Bruxa em cópias restauradas, lounge com DJs tocando synth horror, food trucks e concurso de cosplay macabro.',
      category: 'cinema', date: dn(31, 19), endDate: dn(31, 23, 59), time: '19:00',
      location: 'MIS - Museu da Imagem e do Som', address: 'Av. Europa, 158', neighborhood: 'Jardim Europa',
      price: 20, priceMax: 40, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=800&q=80',
      ticketUrl: 'https://www.mis-sp.org.br/', source: 'MIS SP', sourceUrl: 'https://www.mis-sp.org.br/',
      tags: ['halloween', 'cinema', 'filmes de terror', 'cine horror', 'mis', 'dia das bruxas'],
    },
    {
      title: 'Parque Villa-Lobos: Caça aos Doces ou Travessuras & Halloween Pet (Gratuito)',
      description: 'Grande celebração diurna de Dia das Bruxas para famílias, crianças e seus pets! Trilha do "Doces ou Travessuras", pintura facial de monstrinhos, concurso de fantasias infantil e de pets, contação de causos assustadores e oficinas de artesanato. Grátis.',
      category: 'infantil', date: dn(31, 10), endDate: dn(31, 17), time: '10:00',
      location: 'Parque Villa-Lobos', address: 'Av. Prof. Fonseca Rodrigues, 2001', neighborhood: 'Alto de Pinheiros',
      price: 0, isFree: true, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1508873696983-2df5293cb32f?w=800&q=80',
      ticketUrl: 'https://parquevillalobos.sp.gov.br', source: 'Parques SP', sourceUrl: 'https://parquevillalobos.sp.gov.br',
      tags: ['halloween', 'infantil', 'dia das bruxas', 'doces ou travessuras', 'pet', 'gratuito'],
    },
    {
      title: 'SESC Pompeia: Dia do Saci & Lendas Urbanas de São Paulo (Gratuito)',
      description: '31 de outubro também é o oficial Dia do Saci no Brasil! O SESC Pompeia celebra com contação teatral das lendas urbanas paulistanas (A Loira do Banheiro, O Fantasma do Municipal e o Castelo da Rua Apa), cortejo musical e oficina de fantoches de seres mágicos.',
      category: 'cultura', date: dn(31, 15), endDate: dn(31, 19), time: '15:00',
      location: 'SESC Pompeia', address: 'Rua Clélia, 93', neighborhood: 'Pompeia',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1514533450685-4493e01d1fdc?w=800&q=80',
      ticketUrl: 'https://www.sescsp.org.br/agenda/', source: 'SESC SP', sourceUrl: 'https://www.sescsp.org.br/agenda/',
      tags: ['dia do saci', 'halloween', 'folclore', 'lendas urbanas', 'sesc', 'gratuito'],
    },
    {
      title: 'Zombie Walk São Paulo: Marcha dos Mortos-Vivos no Centro Histórico (Gratuito)',
      description: 'Tradicional concentração anual onde milhares de paulistanos fantasiados e maquiados de zumbis caminham pelas ruas do centro velho de SP. Maquiadores voluntários, flash mobs com coreografia de "Thriller", cortejo musical e arrecadação de alimentos.',
      category: 'cultura', date: dn(31, 14), endDate: dn(31, 18), time: '14:00',
      location: 'Praça do Patriarca & Viaduto do Chá', address: 'Praça do Patriarca, s/n', neighborhood: 'Centro Histórico',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=800&q=80',
      ticketUrl: 'https://www.prefeitura.sp.gov.br', source: 'Prefeitura SP', sourceUrl: 'https://www.prefeitura.sp.gov.br',
      tags: ['halloween', 'zombie walk', 'zumbi', 'centro historico', 'dia das bruxas', 'gratuito'],
    },
    {
      title: 'Tokyo República: Halloween nas Alturas — Rooftop & Karaokê do Terror',
      description: '9 andares de festa na República: karaokês privativos decorados com clássicos cult de horror, pista no terraço com vista para o Copan iluminado de roxo e abóbora, carta de coquetéis com seringas e névoa cenográfica, e sets de indie, dark pop e disco.',
      category: 'festa', date: dn(31, 20), time: '20:00',
      location: 'Tokyo Rooftop', address: 'Rua Major Sertório, 110 — República', neighborhood: 'República',
      price: 50, priceMax: 90, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=800&q=80',
      ticketUrl: 'https://tokyo011.com.br', source: 'Tokyo SP', sourceUrl: 'https://tokyo011.com.br',
      tags: ['halloween', 'balada', 'rooftop', 'tokyo', 'republica', 'karaoke'],
    },
    {
      title: 'Cine Joia: Freak Show Halloween Circus Party',
      description: 'O templo da música na Liberdade se transforma em um bizarro circo dos horrores! Projeção mapeada imersiva 360°, trupe circense burlesca, maquiadores no local e line-up com DJs de electropop, funk e tribal. Premiação para as melhores fantasias.',
      category: 'festa', date: dn(31, 22, 30), time: '22:30',
      location: 'Cine Joia', address: 'Praça Carlos Gomes, 82 — Liberdade', neighborhood: 'Liberdade',
      price: 55, priceMax: 110, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800&q=80',
      ticketUrl: 'https://cinejoia.tv', source: 'Cine Joia', sourceUrl: 'https://cinejoia.tv',
      tags: ['halloween', 'cine joia', 'liberdade', 'freak show', 'balada', 'fantasia'],
    },
    {
      title: 'Vila Madalena Halloween Pub Crawl & Rota dos Bares Assombrados',
      description: 'O circuito etílico mais divertido de São Paulo: passagem guiada por 5 bares temáticos da Vila Madalena, com direito a welcome shots de "poção mágica", petiscos temáticos monstruosos, concurso de fantasias e entrada VIP para a balada de encerramento.',
      category: 'gastronomia', date: dn(31, 18), time: '18:00',
      location: 'Vila Madalena', address: 'Rua Aspicuelta, 300 (Concentração)', neighborhood: 'Vila Madalena',
      price: 65, priceMax: 120, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=800&q=80',
      ticketUrl: 'https://sympla.com.br', source: 'Sympla', sourceUrl: 'https://sympla.com.br',
      tags: ['halloween', 'pub crawl', 'vila madalena', 'gastronomia', 'drinks', 'dia das bruxas'],
    },
    {
      title: 'CCSP: Mostra Literária Macabra — Sarau das Bruxas e Literatura Gótica (Gratuito)',
      description: 'Tarde e noite dedicada aos clássicos da literatura gótica e fantástica no Centro Cultural SP. Leitura dramática ao vivo de contos de Mary Shelley, Edgar Allan Poe e Lygia Fagundes Telles, sarau poético aberto, feira de zines independentes e debates.',
      category: 'literatura', date: dn(31, 17), endDate: dn(31, 21), time: '17:00',
      location: 'Centro Cultural São Paulo', address: 'R. Vergueiro, 1000 — Paraíso', neighborhood: 'Paraíso',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1455849318743-b2233052fcff?w=800&q=80',
      ticketUrl: 'https://centrocultural.sp.gov.br', source: 'Centro Cultural SP', sourceUrl: 'https://centrocultural.sp.gov.br',
      tags: ['halloween', 'literatura', 'sarau', 'bruxas', 'ccsp', 'gratuito'],
    },
    {
      title: 'Edifício Martinelli: Baile de Máscaras & Halloween no Terraço Histórico',
      description: 'No topo do primeiro arranha-céu da cidade, uma festa glamorosa e exclusiva de Halloween. Vista de 360 graus do skyline paulistano, orquestra jazzística de câmara tocando temas de mistério, open bar premium e alta gastronomia.',
      category: 'festa', date: dn(31, 21), time: '21:00',
      location: 'Edifício Martinelli', address: 'Rua São Bento, 405 — Centro', neighborhood: 'Centro Histórico',
      price: 190, priceMax: 380, isFree: false, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=800&q=80',
      ticketUrl: 'https://edificiomartinelli.com.br', source: 'Martinelli', sourceUrl: 'https://edificiomartinelli.com.br',
      tags: ['halloween', 'edificio martinelli', 'baile de mascaras', 'centro', 'destaque'],
    },
    {
      title: 'Escape 60: Noite de Horror Extremo com Atores Vivos — Especial Halloween',
      description: 'Para quem tem coragem de verdade: salas de fuga temáticas com atores profissionais caracterizados como monstros, zumbis e criaturas paranormais interagindo em tempo real. 60 minutos de enigmas e adrenalina pura!',
      category: 'outros', date: dn(31, 15), endDate: dn(31, 23), time: '15:00',
      location: 'Escape 60 Jardins & Moema', address: 'Al. dos Anapurus, 1479 — Moema', neighborhood: 'Moema',
      price: 119, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&q=80',
      ticketUrl: 'https://escape60.com.br', source: 'Escape 60', sourceUrl: 'https://escape60.com.br',
      tags: ['halloween', 'escape room', 'jogos', 'terror', 'moema'],
    },
    {
      title: 'Praça da Liberdade: Feira Noturna Geek, Cosplay & Mística de Halloween (Gratuito)',
      description: 'Feira especial de Dia das Bruxas com mais de 70 barraquinhas: quitutes orientais com temática monstruosa (crepes negros, taiyakis recheados de poção vermelha), tendas de leitura de tarô, concurso de cosplay sobrenatural e flash tattoos.',
      category: 'cultura', date: dn(31, 16), endDate: dn(31, 22), time: '16:00',
      location: 'Praça da Liberdade', address: 'Praça da Liberdade, s/n', neighborhood: 'Liberdade',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1569050467447-ce54b3bbc37d?w=800&q=80',
      ticketUrl: 'https://www.cidadedesaopaulo.com', source: 'SP Turismo', sourceUrl: 'https://www.cidadedesaopaulo.com',
      tags: ['halloween', 'liberdade', 'geek', 'cosplay', 'feira noturna', 'gratuito'],
    },
    {
      title: 'Cinemateca Brasileira: Ciclo Cinema Macabro e Clássicos de Horror (Gratuito)',
      description: 'Projeção ao ar livre nos jardins da Cinemateca com clássicos do terror mundial: Drácula de Bela Lugosi, Nosferatu com acompanhamento de piano ao vivo e O Bebê de Rosemary. Entrada gratuita com retirada de senha 1h antes.',
      category: 'cinema', date: dn(30, 19), endDate: dn(31, 22), time: '19:00',
      location: 'Cinemateca Brasileira', address: 'Largo Senador Raul Cardoso, 207', neighborhood: 'Vila Clementino',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=800&q=80',
      ticketUrl: 'https://cinemateca.org.br', source: 'Cinemateca', sourceUrl: 'https://cinemateca.org.br',
      tags: ['halloween', 'cinemateca', 'cinema de terror', 'gratuito', 'filmes'],
    },
    {
      title: 'Hopi Hari: Noite dos Horrores Especial Pré-Halloween',
      description: 'O maior parque temático da região de SP com túneis assustadores, dezenas de atores caracterizados, shows musicais de abertura e montanhas-russas funcionando até altas horas da noite. Transporte especial saindo do Terminal Barra Funda.',
      category: 'outros', date: dn(30, 17), time: '17:00',
      location: 'Hopi Hari (Saída Barra Funda)', address: 'Terminal Rodoviário Barra Funda', neighborhood: 'Barra Funda',
      price: 139, priceMax: 219, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1513889961551-628c1e5e2ee9?w=800&q=80',
      ticketUrl: 'https://hopihari.com.br', source: 'Hopi Hari', sourceUrl: 'https://hopihari.com.br',
      tags: ['halloween', 'hopi hari', 'noite dos horrores', 'parque', 'adrenalina'],
    },
    {
      title: 'Memorial da América Latina: Grande Festival Dia de Los Muertos (Gratuito)',
      description: 'Tradicional e emocionante celebração do Dia dos Mortos com rica herança mexicana! Apresentações ao vivo de grupos Mariachis, altares gigantes de oferendas e flores de cempasúchil, concurso do melhor desfile de Catrinas e muita gastronomia mexicana.',
      category: 'cultura', date: dn(31, 11), endDate: dn(31, 21), time: '11:00',
      location: 'Memorial da América Latina', address: 'Av. Auro Soares de Moura Andrade, 664', neighborhood: 'Barra Funda',
      price: 0, isFree: true, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=800&q=80',
      ticketUrl: 'https://memorial.org.br', source: 'Memorial América Latina', sourceUrl: 'https://memorial.org.br',
      tags: ['dia de los muertos', 'mexico', 'halloween', 'memorial', 'catrinas', 'gratuito'],
    },

    // ══════════════════════════════════════════════════════════════════════════
    // 🍂 OUTUBRO — GRANDES EVENTOS DO MÊS INTEIRO 🍂
    // ══════════════════════════════════════════════════════════════════════════
    {
      title: 'São Paulo Oktoberfest 2026 — Parque Villa-Lobos',
      description: 'A autêntica festa da cerveja de São Paulo com cervejarias artesanais, comidas típicas alemãs (joelho de porco, salsichões, brezel), bandas folclóricas bávaras e shows com grandes nomes do rock e pop nacional.',
      category: 'gastronomia', date: dn(2, 16), endDate: dn(5, 23), time: '16:00',
      location: 'Parque Villa-Lobos', address: 'Av. Prof. Fonseca Rodrigues, 2001', neighborhood: 'Alto de Pinheiros',
      price: 60, priceMax: 180, isFree: false, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=800&q=80',
      ticketUrl: 'https://saopaulooktoberfest.com.br', source: 'Oktoberfest SP', sourceUrl: 'https://saopaulooktoberfest.com.br',
      tags: ['oktoberfest', 'cerveja', 'festa', 'gastronomia', 'shows'],
    },
    {
      title: 'Brasil Game Show (BGS 2026) — O Maior Evento de Games da América Latina',
      description: 'Lançamentos mundiais de videogames para testar antes de todo mundo, campeonatos eletrizantes de eSports, presença de lendas da indústria internacional de games, área cosplay gigantesca e centenas de estandes interativos.',
      category: 'tecnologia', date: dn(8, 13), endDate: dn(11, 21), time: '13:00',
      location: 'Expo Center Norte', address: 'Rua José Bernardo Pinto, 333', neighborhood: 'Vila Guilherme',
      price: 120, priceMax: 350, isFree: false, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=800&q=80',
      ticketUrl: 'https://brasilgameshow.com.br', source: 'BGS', sourceUrl: 'https://brasilgameshow.com.br',
      tags: ['bgs', 'games', 'tecnologia', 'esports', 'cosplay'],
    },
    {
      title: 'Show: Jorge Ben Jor & Banda Zé Pretinho — Espaço Unimed',
      description: 'O mestre do samba-rock e da música brasileira em um show épico com todos os hinos atemporais: Taj Mahal, Mas Que Nada, Chove Chuva, País Tropical e Fio Maravilha. Pista e camarotes disponíveis.',
      category: 'musica', date: dn(3, 21), time: '21:00',
      location: 'Espaço Unimed', address: 'R. Tagipuru, 795 — Barra Funda', neighborhood: 'Barra Funda',
      price: 110, priceMax: 320, isFree: false, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&q=80',
      ticketUrl: 'https://espacounimed.com.br', source: 'Espaço Unimed', sourceUrl: 'https://espacounimed.com.br',
      tags: ['jorge ben jor', 'musica', 'show', 'samba rock', 'barra funda'],
    },
    {
      title: 'Festival das Crianças no Parque Ibirapuera (Gratuito)',
      description: 'Especial Semana e Dia das Crianças (12/10)! Três palcos com espetáculos circenses, teatro de bonecos, contação de fábulas, shows de mágica e oficinas científicas. Piquenique aberto e atrações 100% gratuitas.',
      category: 'infantil', date: dn(11, 10), endDate: dn(12, 18), time: '10:00',
      location: 'Parque Ibirapuera — Praça da Paz', address: 'Av. Pedro Álvares Cabral, s/n', neighborhood: 'Vila Mariana',
      price: 0, isFree: true, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?w=800&q=80',
      ticketUrl: 'https://ibirapuera.org', source: 'Parque Ibirapuera', sourceUrl: 'https://ibirapuera.org',
      tags: ['dia das criancas', 'infantil', 'ibirapuera', 'circo', 'gratuito'],
    },
    {
      title: 'Circo Stankowich — Especial Mês das Crianças',
      description: 'O mais antigo e consagrado circo tradicional do Brasil apresenta um super espetáculo com trapezistas voadores, o incrível Globo da Morte com 6 motos, águas dançantes e palhaços premiados mundialmente.',
      category: 'cultura', date: dn(10, 17), endDate: dn(12, 20), time: '17:00',
      location: 'Sambódromo do Anhembi', address: 'Av. Olavo Fontoura, 1209 — Santana', neighborhood: 'Santana',
      price: 40, priceMax: 120, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=800&q=80',
      ticketUrl: 'https://stankowich.com.br', source: 'Circo Stankowich', sourceUrl: 'https://stankowich.com.br',
      tags: ['circo', 'stankowich', 'infantil', 'familia', 'anhembi'],
    },
    {
      title: '48ª Mostra Internacional de Cinema de São Paulo',
      description: 'O festival cinematográfico mais relevante do país exibe mais de 300 filmes inéditos vindos de 60 países. Sessões no CineSesc, Espaço Itaú Augusta, IMS Paulista e projeções gratuitas no vão do MASP.',
      category: 'cinema', date: dn(18, 14), endDate: dn(31, 23), time: '14:00',
      location: 'Circuito de Cinemas de SP', address: 'Diversas salas (CineSesc, CCSP, Reserva)', neighborhood: 'Consolação e Centro',
      price: 24, priceMax: 48, isFree: false, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=800&q=80',
      ticketUrl: 'https://mostra.org', source: 'Mostra SP', sourceUrl: 'https://mostra.org',
      tags: ['mostra sp', 'cinema', 'filmes', 'cinesesc', 'festival de cinema'],
    },
    {
      title: 'São Paulo Fashion Week (SPFW) — Pavilhão da Bienal',
      description: 'A semana de moda mais prestigiada do hemisfério sul. Desfiles das maiores marcas e estilistas de vanguarda, exposições de fotografia têxtil, palestras sobre sustentabilidade e pop-up stores de designers independentes.',
      category: 'cultura', date: dn(14, 15), endDate: dn(18, 22), time: '15:00',
      location: 'Pavilhão da Bienal — Ibirapuera', address: 'Portão 3 — Parque Ibirapuera', neighborhood: 'Vila Mariana',
      price: 80, priceMax: 300, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80',
      ticketUrl: 'https://spfw.com.br', source: 'SPFW', sourceUrl: 'https://spfw.com.br',
      tags: ['spfw', 'moda', 'bienal', 'estilo', 'ibirapuera'],
    },
    {
      title: 'Festival do Café e Sabores Paulistas — Museu da Imigração',
      description: 'Feira gastronômica com os melhores cafés especiais do estado de SP, baristas premiados ministrando workshops gratuitos, doces típicos da roça, queijos artesanais e apresentações musicais de choro e caipira nos jardins históricos.',
      category: 'gastronomia', date: dn(17, 10), endDate: dn(18, 18), time: '10:00',
      location: 'Museu da Imigração', address: 'Rua Visconde de Parnaíba, 1316 — Mooca', neighborhood: 'Mooca',
      price: 16, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1447933601403-0c6688de566e?w=800&q=80',
      ticketUrl: 'https://museudaimigracao.org.br', source: 'Museu da Imigração', sourceUrl: 'https://museudaimigracao.org.br',
      tags: ['cafe', 'gastronomia', 'mooca', 'museu da imigracao', 'feira'],
    },
    {
      title: 'Balé Bolshoi: Gala Clássica — Theatro Municipal de São Paulo',
      description: 'Solistas consagrados da Escola do Teatro Bolshoi executam trechos de O Quebra-Nozes, Don Quixote e Spartacus, acompanhados ao vivo pela Orquestra Sinfônica Municipal. Cenários suntuosos e técnica impecável.',
      category: 'danca', date: dn(16, 20), endDate: dn(17, 20), time: '20:00',
      location: 'Theatro Municipal de São Paulo', address: 'Praça Ramos de Azevedo, s/n', neighborhood: 'Centro Histórico',
      price: 50, priceMax: 240, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1518611507888-3e15cce98b21?w=800&q=80',
      ticketUrl: 'https://theatromunicipal.org.br', source: 'Theatro Municipal', sourceUrl: 'https://theatromunicipal.org.br',
      tags: ['bale', 'danca', 'theatro municipal', 'bolshoi', 'cultura'],
    },
    {
      title: 'Night Run SP — Corrida Noturna no Sambódromo do Anhembi',
      description: 'A corrida noturna mais eletrizante do Brasil! Circuitos de 5km e 10km na passarela do samba com túneis de luz neon, DJs tocando ao longo do percurso, show na chegada e arena com massagem e hidratação.',
      category: 'esporte', date: dn(24, 19), time: '19:00',
      location: 'Sambódromo do Anhembi', address: 'Av. Olavo Fontoura, 1209 — Santana', neighborhood: 'Santana',
      price: 89, priceMax: 160, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1452626038306-9aae5e071b52?w=800&q=80',
      ticketUrl: 'https://runningland.com.br', source: 'Night Run', sourceUrl: 'https://runningland.com.br',
      tags: ['corrida', 'night run', 'esporte', 'anhembi', 'fitness'],
    },
    {
      title: 'Festival de Primavera no Jardim Botânico (Gratuito)',
      description: 'Exposição botânica com mais de 500 orquídeas e bromélias raras, feira de mudas, visitas guiadas pelas estufas históricas e caminhadas meditativas em meio à Mata Atlântica preservada da zona sul.',
      category: 'cultura', date: dn(4, 9), endDate: dn(4, 17), time: '09:00',
      location: 'Jardim Botânico de São Paulo', address: 'Av. Miguel Estefno, 3031', neighborhood: 'Água Funda',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=800&q=80',
      ticketUrl: 'https://jardimbotanico.sp.gov.br', source: 'Jardim Botânico', sourceUrl: 'https://jardimbotanico.sp.gov.br',
      tags: ['flores', 'jardim botanico', 'natureza', 'primavera', 'gratuito'],
    },
    {
      title: 'Noite de Jazz & Vinhos no JazzB — República',
      description: 'Uma noite intimista com o sexteto de jazz paulistano homenageando Miles Davis e John Coltrane. Carta especial de vinhos de pequenos produtores nacionais e tábua de queijos artesanais da serra da Mantiqueira.',
      category: 'musica', date: dn(9, 21), time: '21:00',
      location: 'JazzB', address: 'Rua General Jardim, 43 — Vila Buarque', neighborhood: 'República',
      price: 40, priceMax: 70, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?w=800&q=80',
      ticketUrl: 'https://jazzb.net', source: 'JazzB', sourceUrl: 'https://jazzb.net',
      tags: ['jazz', 'musica', 'jazzb', 'vinhos', 'republica'],
    },
    {
      title: 'Hackathon SP Tech — Inteligência Artificial no InovaUSP (Gratuito)',
      description: 'Maratona hacker de 48 horas focada no desenvolvimento de soluções de IA para saúde pública, mobilidade urbana e educação em SP. Mentoria com especialistas do Google, premiações e networking com investidores.',
      category: 'tecnologia', date: dn(17, 9), endDate: dn(18, 18), time: '09:00',
      location: 'InovaUSP — Cidade Universitária', address: 'Av. Prof. Lúcio Martins Rodrigues, 370', neighborhood: 'Butantã',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=800&q=80',
      ticketUrl: 'https://inova.usp.br', source: 'InovaUSP', sourceUrl: 'https://inova.usp.br',
      tags: ['hackathon', 'tecnologia', 'inteligencia artificial', 'usp', 'gratuito'],
    },
    {
      title: 'Roda de Samba Tradicional do Bixiga na Rua 13 de Maio (Gratuito)',
      description: 'O autêntico samba de raiz do tradicional bairro do Bixiga: cavaquinho, pandeiro e surdo comandados pelos baluartes da Vai-Vai. Mesas na calçada, cerveja gelada e porções de pastel com queijo canastra.',
      category: 'musica', date: dn(7, 19), time: '19:00',
      location: 'Rua Treze de Maio (Bixiga)', address: 'Rua Treze de Maio, 800', neighborhood: 'Bela Vista',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800&q=80',
      ticketUrl: 'https://www.prefeitura.sp.gov.br', source: 'Prefeitura SP', sourceUrl: 'https://www.prefeitura.sp.gov.br',
      tags: ['samba', 'bixiga', 'musica', 'gratuito', 'roda de samba'],
    },
    {
      title: 'Stand-Up Comedy All-Stars — Clube do Minhoca',
      description: 'Noite com os 5 maiores nomes da nova geração do humor stand-up nacional em um dos clubes de comédia mais charmosos do centro de SP. Risadas garantidas e drinks artesanais.',
      category: 'teatro', date: dn(20, 20, 30), time: '20:30',
      location: 'Clube do Minhoca', address: 'Rua Conselheiro Nébias, 131', neighborhood: 'Campos Elíseos',
      price: 45, priceMax: 70, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1508345228704-935cc84bf5e2?w=800&q=80',
      ticketUrl: 'https://clubedominhoca.com.br', source: 'Clube do Minhoca', sourceUrl: 'https://clubedominhoca.com.br',
      tags: ['stand up', 'comedia', 'teatro', 'humor', 'centro'],
    },
    {
      title: 'Farol Santander: Exposição "Ocultismo e Mitologias Antigas"',
      description: 'Instalação imersiva de artes visuais explorando as raízes do misticismo, símbolos esotéricos e lendas antigas através de esculturas, hologramas e projeções sonoras 8D. Visita inclui o mirante no 26º andar.',
      category: 'exposicao', date: dn(22, 9), time: '09:00',
      location: 'Farol Santander', address: 'Rua João Brícola, 24 — Centro', neighborhood: 'Centro Histórico',
      price: 35, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1580060839134-75a5edca2e99?w=800&q=80',
      ticketUrl: 'https://farolsantander.com.br', source: 'Farol Santander', sourceUrl: 'https://farolsantander.com.br',
      tags: ['farol santander', 'exposicao', 'arte', 'mirante', 'centro'],
    },
    {
      title: 'Passeio Ciclístico Noturno de São Paulo (Gratuito)',
      description: 'Passeio ciclístico de 15km pelas vias icônicas de SP iluminadas à noite: Av. Paulista, Minhocão, Praça Roosevelt e Vale do Anhangabaú. Apoio mecânico, batedores da CET e ritmo leve para ciclistas de todas as idades.',
      category: 'esporte', date: dn(21, 20), time: '20:00',
      location: 'Praça do Ciclista — Av. Paulista', address: 'Av. Paulista, 2444', neighborhood: 'Bela Vista',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1558618047-3c8c76ca7d13?w=800&q=80',
      ticketUrl: 'https://www.prefeitura.sp.gov.br', source: 'Prefeitura SP', sourceUrl: 'https://www.prefeitura.sp.gov.br',
      tags: ['ciclismo', 'bike', 'esporte', 'paulista', 'gratuito'],
    },

    // ══════════════════════════════════════════════════════════════════════════
    // 🏛️ INSTITUIÇÕES PERMANENTES & SESCs (SETEMBRO E OUTUBRO) 🏛️
    // ══════════════════════════════════════════════════════════════════════════
    {
      title: 'SESC Pinheiros — Festival de Jazz Contemporâneo',
      description: 'Três noites de jazz com instrumentistas nacionais e internacionais. Masterclasses gratuitas e jam sessions abertas ao público após as apresentações principais.',
      category: 'musica', date: d(27, 20), endDate: d(29, 23), time: '20:00',
      location: 'SESC Pinheiros', address: 'Rua Paes Leme, 195', neighborhood: 'Pinheiros',
      price: 0, isFree: true, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?w=800&q=80',
      ticketUrl: 'https://www.sescsp.org.br/agenda/', source: 'SESC SP', sourceUrl: 'https://www.sescsp.org.br/agenda/',
      tags: ['jazz', 'sesc pinheiros', 'musica', 'gratuito'],
    },
    {
      title: 'Feira Noturna Gastronômica & Jazz — Praça Benedito Calixto (Gratuito)',
      description: 'Edição noturna especial com barraquinhas de gastronomia de rua (hambúrgueres artesanais, empanadas argentinas, churros e chopes locais) acompanhada de shows de jazz e choro sob as árvores da praça.',
      category: 'gastronomia', date: d(27, 18), endDate: d(27, 23), time: '18:00',
      location: 'Praça Benedito Calixto', address: 'Praça Benedito Calixto, s/n', neighborhood: 'Pinheiros',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800&q=80',
      ticketUrl: 'https://beneditocalixto.com.br', source: 'Benedito Calixto', sourceUrl: 'https://beneditocalixto.com.br',
      tags: ['gastronomia', 'benedito calixto', 'pinheiros', 'jazz', 'gratuito'],
    },
    {
      title: 'Concerto Sinfônico OSESP na Sala São Paulo',
      description: 'A aclamada Orquestra Sinfônica do Estado de São Paulo apresenta a 9ª Sinfonia de Beethoven com coro completo em uma das salas de concerto com melhor acústica do planeta.',
      category: 'musica', date: d(28, 16), time: '16:00',
      location: 'Sala São Paulo', address: 'Praça Júlio Prestes, 16 — Campos Elíseos', neighborhood: 'Luz',
      price: 35, priceMax: 180, isFree: false, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=800&q=80',
      ticketUrl: 'https://osesp.art.br', source: 'OSESP', sourceUrl: 'https://osesp.art.br',
      tags: ['osesp', 'musica classica', 'sala sao paulo', 'beethoven'],
    },
    {
      title: 'Domingo Sem Carro na Av. Paulista — Cultura e Esporte na Rua (Gratuito)',
      description: 'A avenida mais famosa do Brasil fechada para veículos e aberta exclusivamente para pedestres, ciclistas e skatistas. Shows acústicos a cada quarteirão, feira de artesãos e aulas coletivas de dança.',
      category: 'esporte', date: d(28, 8), endDate: d(28, 16), time: '08:00',
      location: 'Avenida Paulista', address: 'Av. Paulista, toda a extensão', neighborhood: 'Bela Vista',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1558618047-3c8c76ca7d13?w=800&q=80',
      ticketUrl: 'https://www.prefeitura.sp.gov.br', source: 'Prefeitura SP', sourceUrl: 'https://www.prefeitura.sp.gov.br',
      tags: ['paulista aberta', 'esporte', 'lazer', 'gratuito', 'musica de rua'],
    },
    {
      title: 'SESC Pompeia — Cinema na Varanda: Clássicos Premiados (Gratuito)',
      description: 'Sessões gratuitas de cinema cult nas noites de fim de semana na emblemática varanda projetada por Lina Bo Bardi. Pipoca liberada e bate-papo cinematográfico após a exibição.',
      category: 'cinema', date: d(27, 19), time: '19:00',
      location: 'SESC Pompeia', address: 'Rua Clélia, 93', neighborhood: 'Pompeia',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=800&q=80',
      ticketUrl: 'https://www.sescsp.org.br/agenda/', source: 'SESC SP', sourceUrl: 'https://www.sescsp.org.br/agenda/',
      tags: ['cinema', 'sesc pompeia', 'gratuito', 'cultura'],
    },
    {
      title: 'MASP — "Histórias Paulistanas": Obras do Acervo Permanente (Terça Grátis)',
      description: 'A fantástica expografia nos cavaletes de cristal de Lina Bo Bardi reunindo obras de Van Gogh, Renoir, Cézanne, Candido Portinari e Tarsila do Amaral. Entrada gratuita toda terça-feira mediante agendamento prévio.',
      category: 'exposicao', date: d(29, 10), time: '10:00',
      location: 'MASP', address: 'Av. Paulista, 1578', neighborhood: 'Bela Vista',
      price: 0, isFree: true, featured: true,
      imageUrl: 'https://images.unsplash.com/photo-1580060839134-75a5edca2e99?w=800&q=80',
      ticketUrl: 'https://masp.org.br', source: 'MASP', sourceUrl: 'https://masp.org.br',
      tags: ['masp', 'arte', 'museu', 'paulista', 'exposicao', 'gratuito'],
    },
    {
      title: 'Pinacoteca de São Paulo — Arte Brasileira dos Séculos XIX e XX (Sábado Grátis)',
      description: 'A mais antiga instituição de arte de São Paulo apresenta seu acervo magistral, incluindo obras icônicas como O Mestiço e Saudade. Entrada franca aos sábados para todos os públicos.',
      category: 'exposicao', date: d(27, 10), time: '10:00',
      location: 'Pinacoteca do Estado', address: 'Praça da Luz, 2 — Luz', neighborhood: 'Luz',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1518998053901-5348d3961a04?w=800&q=80',
      ticketUrl: 'https://pinacoteca.org.br', source: 'Pinacoteca SP', sourceUrl: 'https://pinacoteca.org.br',
      tags: ['pinacoteca', 'arte brasileira', 'museu', 'luz', 'exposicao', 'gratuito'],
    },
    {
      title: 'IMS Paulista — Fotografia Contemporânea Brasileira (Gratuito)',
      description: 'Exposição fotográfica em três andares do Instituto Moreira Salles, com terraço panorâmico e centro de documentação de fotografia do Brasil. Totalmente gratuito.',
      category: 'exposicao', date: d(28, 10), time: '10:00',
      location: 'IMS Paulista', address: 'Av. Paulista, 2424', neighborhood: 'Bela Vista',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=800&q=80',
      ticketUrl: 'https://ims.com.br', source: 'IMS', sourceUrl: 'https://ims.com.br',
      tags: ['ims', 'fotografia', 'paulista', 'gratuito', 'exposicao'],
    },
    {
      title: 'Museu Catavento — Ciência Interativa e Planetário',
      description: 'O museu de ciências mais divertido do Brasil instalado no Palácio das Indústrias: gerador Van de Graaff, nave espacial com simulação, borboletário e sala de astronomia. Ideal para mentes curiosas.',
      category: 'infantil', date: d(28, 9), time: '09:00',
      location: 'Museu Catavento', address: 'Av. Mercúrio, s/n — Brás', neighborhood: 'Brás',
      price: 18, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?w=800&q=80',
      ticketUrl: 'https://museucatavento.org.br', source: 'Catavento', sourceUrl: 'https://museucatavento.org.br',
      tags: ['catavento', 'ciencia', 'infantil', 'museu', 'planetario'],
    },
    {
      title: 'Expo Aviação & Simuladores — Aeroporto Campo de Marte',
      description: 'Aeronaves clássicas da aviação civil e militar abertas para visitação interna, simuladores de caça e Boeing 737, além de voos panorâmicos de helicóptero sobre a capital paulista.',
      category: 'aviacao', date: dn(19, 9), endDate: dn(20, 18), time: '09:00',
      location: 'Campo de Marte', address: 'Av. Santos Dumont, 1979', neighborhood: 'Santana',
      price: 35, priceMax: 180, isFree: false,
      imageUrl: 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=800&q=80',
      ticketUrl: 'https://sympla.com.br', source: 'Sympla', sourceUrl: 'https://sympla.com.br',
      tags: ['aviacao', 'campo de marte', 'avioes', 'santana', 'expo'],
    },
    {
      title: 'Mercado Municipal de SP — Tour Gastronômico Paulistano de Domingo',
      description: 'Visita gastronômica ao histórico Mercadão de São Paulo: o famoso sanduíche de mortadela gigante, pastel de bacalhau crocante e frutas raras de todas as regiões tropicais do Brasil.',
      category: 'gastronomia', date: d(28, 8), time: '08:00',
      location: 'Mercado Municipal de SP', address: 'R. da Cantareira, 306 — Centro', neighborhood: 'Centro Histórico',
      price: 0, isFree: true,
      imageUrl: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&q=80',
      ticketUrl: 'https://mercadaomunicipal.com.br', source: 'Mercadão SP', sourceUrl: 'https://mercadaomunicipal.com.br',
      tags: ['mercadao', 'gastronomia', 'centro', 'pastel de bacalhau', 'comida'],
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

  if (/halloween|bruxa|saci|fantasia|horror|terror|macabr/i.test(text)) return 'festa';
  if (/jazz|rock|show|música|concert|band|samba|forró|mpb|pop|metal|rap|funk|eletrôni|festival music/i.test(text)) return 'musica';
  if (/teatro|peça|espetáculo|cena|palco|dramaturgia|ópera/i.test(text)) return 'teatro';
  if (/exposiç|museu|galeria|arte|pintura|escultura|fotografia|instalação/i.test(text)) return 'exposicao';
  if (/gastro|culinária|chef|food|alimentação|vinho|cerveja|cervejaria|feira de comida|oktoberfest/i.test(text)) return 'gastronomia';
  if (/esporte|corrida|maratona|futebol|tênis|basquete|vôlei|ciclismo|natação|fitness/i.test(text)) return 'esporte';
  if (/tech|tecnologia|startup|programação|inovaç|digital|hackathon|developer|TI\b|game|bgs/i.test(text)) return 'tecnologia';
  if (/aviaç|aeronave|avião|helicóptero|piloto|voo|aeroporto|aeronáutica/i.test(text)) return 'aviacao';
  if (/cinema|filme|movie|sessão|curta|longa|mostra sp/i.test(text)) return 'cinema';
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
  if (!forceRefresh && typeof localStorage !== 'undefined') {
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

  // 1. Tenta carregar do feed estático atualizado diariamente via GitHub Actions
  try {
    const cacheBuster = forceRefresh ? `?t=${Date.now()}` : '';
    const res = await fetch(`/data/events.json${cacheBuster}`);
    if (res.ok) {
      const data = await res.json();
      const dynamicEvents = (data.events || data) as Event[];
      if (Array.isArray(dynamicEvents) && dynamicEvents.length > 0) {
        dynamicEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        if (typeof localStorage !== 'undefined') {
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(dynamicEvents));
            localStorage.setItem(CACHE_TIMESTAMP_KEY, String(Date.now()));
          } catch {}
        }
        return dynamicEvents;
      }
    }
  } catch (err) {
    console.warn('[eventService] Falha ao carregar /data/events.json, usando fallback:', err);
  }

  const now = new Date();
  const fromDate = format(startOfMonth(now), 'yyyy-MM-dd');
  const toDate = format(endOfMonth(addMonths(now, 1)), 'yyyy-MM-dd');
  void fromDate;
  void toDate;

  // Always start with mock events to ensure the app has content if offline or initial load
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

  // Filter to current + next month date range (plus a few days margin to include full transitions)
  const rangeStart = startOfMonth(now);
  const rangeEnd = addDays(endOfMonth(addMonths(now, 1)), 2);

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
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(filtered));
      localStorage.setItem(CACHE_TIMESTAMP_KEY, String(Date.now()));
    } catch {
      // ignore storage errors
    }
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
        (e.neighborhood || '').toLowerCase().includes(q) ||
        (e.tags && e.tags.some((t) => t.toLowerCase().includes(q)));
      if (!match) return false;
    }

    // Date filter — compare as YYYY-MM-DD strings to avoid UTC timezone shift
    if (filters.selectedDate) {
      const sel = filters.selectedDate;
      // Build a local YYYY-MM-DD string for the selected date
      const selStr =
        `${sel.getFullYear()}-${String(sel.getMonth() + 1).padStart(2, '0')}-${String(sel.getDate()).padStart(2, '0')}`;

      const eventStartStr = e.date.slice(0, 10); // "YYYY-MM-DD"

      // Evento começa exatamente no dia selecionado
      if (eventStartStr === selStr) return true;

      // Se for um evento curto de múltiplos dias (ex: festival de fim de semana de até 3 dias)
      if (e.endDate) {
        const eventEndStr = e.endDate.slice(0, 10);
        const startTimestamp = new Date(eventStartStr + 'T00:00:00').getTime();
        const endTimestamp = new Date(eventEndStr + 'T00:00:00').getTime();
        const diffDays = Math.round((endTimestamp - startTimestamp) / (1000 * 60 * 60 * 24));

        // Permite apenas eventos curtos de fim de semana (até 3 dias) que ocorrem na data selecionada
        if (diffDays > 0 && diffDays <= 3 && eventStartStr <= selStr && eventEndStr >= selStr) {
          return true;
        }
      }

      return false;
    }

    return true;
  });
}

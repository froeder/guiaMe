export type EventCategory =
  | 'musica'
  | 'teatro'
  | 'exposicao'
  | 'cultura'
  | 'gastronomia'
  | 'esporte'
  | 'tecnologia'
  | 'aviacao'
  | 'cinema'
  | 'danca'
  | 'literatura'
  | 'infantil'
  | 'festa'
  | 'outros';

export interface Event {
  id: string;
  title: string;
  description: string;
  category: EventCategory;
  date: string; // ISO string
  endDate?: string; // ISO string
  time?: string; // "HH:mm"
  endTime?: string;
  location: string;
  address?: string;
  neighborhood?: string;
  price: number; // 0 = free
  priceMax?: number; // for range
  isFree: boolean;
  imageUrl?: string;
  ticketUrl?: string;
  source: string; // e.g. "sympla", "eventbrite", "cultura_sp"
  sourceUrl: string;
  tags?: string[];
  featured?: boolean;
}

export type PriceFilter = 'all' | 'free' | 'paid';

export interface EventFilters {
  categories: EventCategory[];
  priceFilter: PriceFilter;
  searchQuery: string;
  selectedDate: Date | null;
}

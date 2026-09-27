import type { EventCategory } from '../types/event';

export const CATEGORY_CONFIG: Record<EventCategory, { label: string; emoji: string; color: string; bg: string }> = {
  musica: {
    label: 'Música',
    emoji: '🎵',
    color: '#F472B6',
    bg: 'rgba(244, 114, 182, 0.15)',
  },
  teatro: {
    label: 'Teatro',
    emoji: '🎭',
    color: '#818CF8',
    bg: 'rgba(129, 140, 248, 0.15)',
  },
  exposicao: {
    label: 'Exposição',
    emoji: '🖼️',
    color: '#34D399',
    bg: 'rgba(52, 211, 153, 0.15)',
  },
  cultura: {
    label: 'Cultura',
    emoji: '🏛️',
    color: '#FBBF24',
    bg: 'rgba(251, 191, 36, 0.15)',
  },
  gastronomia: {
    label: 'Gastronomia',
    emoji: '🍽️',
    color: '#F97316',
    bg: 'rgba(249, 115, 22, 0.15)',
  },
  esporte: {
    label: 'Esporte',
    emoji: '⚡',
    color: '#22D3EE',
    bg: 'rgba(34, 211, 238, 0.15)',
  },
  tecnologia: {
    label: 'Tecnologia',
    emoji: '💻',
    color: '#60A5FA',
    bg: 'rgba(96, 165, 250, 0.15)',
  },
  aviacao: {
    label: 'Aviação',
    emoji: '✈️',
    color: '#A78BFA',
    bg: 'rgba(167, 139, 250, 0.15)',
  },
  cinema: {
    label: 'Cinema',
    emoji: '🎬',
    color: '#FB7185',
    bg: 'rgba(251, 113, 133, 0.15)',
  },
  danca: {
    label: 'Dança',
    emoji: '💃',
    color: '#E879F9',
    bg: 'rgba(232, 121, 249, 0.15)',
  },
  literatura: {
    label: 'Literatura',
    emoji: '📚',
    color: '#86EFAC',
    bg: 'rgba(134, 239, 172, 0.15)',
  },
  infantil: {
    label: 'Infantil',
    emoji: '🎈',
    color: '#FDE68A',
    bg: 'rgba(253, 230, 138, 0.15)',
  },
  festa: {
    label: 'Festa',
    emoji: '🎉',
    color: '#FDA4AF',
    bg: 'rgba(253, 164, 175, 0.15)',
  },
  outros: {
    label: 'Outros',
    emoji: '🌟',
    color: '#94A3B8',
    bg: 'rgba(148, 163, 184, 0.15)',
  },
};

export const ALL_CATEGORIES: EventCategory[] = [
  'musica', 'teatro', 'exposicao', 'cultura', 'gastronomia',
  'esporte', 'tecnologia', 'aviacao', 'cinema', 'danca',
  'literatura', 'infantil', 'festa', 'outros',
];

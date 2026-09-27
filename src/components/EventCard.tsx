import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { Event } from '../types/event';
import { CATEGORY_CONFIG } from '../utils/categories';
import styles from './EventCard.module.css';

interface EventCardProps {
  event: Event;
  style?: React.CSSProperties;
}

const FALLBACK_IMAGES: Record<string, string> = {
  musica: 'https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?w=600&q=80',
  teatro: 'https://images.unsplash.com/photo-1503095396549-807759245b35?w=600&q=80',
  exposicao: 'https://images.unsplash.com/photo-1580060839134-75a5edca2e99?w=600&q=80',
  cultura: 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=600&q=80',
  gastronomia: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=600&q=80',
  esporte: 'https://images.unsplash.com/photo-1452626038306-9aae5e071b52?w=600&q=80',
  tecnologia: 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=600&q=80',
  aviacao: 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=600&q=80',
  cinema: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=600&q=80',
  danca: 'https://images.unsplash.com/photo-1518611507888-3e15cce98b21?w=600&q=80',
  literatura: 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=600&q=80',
  infantil: 'https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?w=600&q=80',
  festa: 'https://images.unsplash.com/photo-1551818255-e6e10975bc17?w=600&q=80',
  outros: 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=600&q=80',
};

export function EventCard({ event, style }: EventCardProps) {
  const [imgError, setImgError] = useState(false);
  const cfg = CATEGORY_CONFIG[event.category];

  const eventDate = parseISO(event.date);
  const dateStr = format(eventDate, "EEE, d 'de' MMM", { locale: ptBR });
  const timeStr = event.time || format(eventDate, 'HH:mm');

  const imgSrc = (!event.imageUrl || imgError) ? FALLBACK_IMAGES[event.category] : event.imageUrl;

  const priceStr = event.isFree
    ? 'Gratuito'
    : event.price === 0
    ? 'Ver preço'
    : event.priceMax
    ? `R$ ${event.price} – R$ ${event.priceMax}`
    : `A partir de R$ ${event.price}`;

  return (
    <article
      className={`${styles.card} ${event.featured ? styles.cardFeatured : ''}`}
      style={style}
    >
      {/* Image */}
      <div className={styles.imageWrapper}>
        <img
          src={imgSrc}
          alt={event.title}
          className={styles.image}
          loading="lazy"
          onError={() => setImgError(true)}
        />
        <div className={styles.imageOverlay} />

        {/* Category badge */}
        <span
          className={styles.categoryBadge}
          style={{ '--cat-color': cfg.color, '--cat-bg': cfg.bg } as React.CSSProperties}
        >
          {cfg.emoji} {cfg.label}
        </span>

        {/* Featured badge */}
        {event.featured && (
          <span className={styles.featuredBadge}>⭐ Destaque</span>
        )}

        {/* Price badge */}
        <span className={`badge ${event.isFree ? 'badge-free' : 'badge-paid'} ${styles.priceBadge}`}>
          {event.isFree ? '🎟️ Grátis' : `💳 ${priceStr}`}
        </span>
      </div>

      {/* Content */}
      <div className={styles.content}>
        <h3 className={styles.title}>{event.title}</h3>

        <div className={styles.meta}>
          <div className={styles.metaItem}>
            <span className={styles.metaIcon}>📅</span>
            <span>{dateStr}</span>
            {timeStr && timeStr !== '00:00' && (
              <span className={styles.time}>{timeStr}</span>
            )}
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaIcon}>📍</span>
            <span className={styles.location}>{event.location}</span>
            {event.neighborhood && (
              <span className={styles.neighborhood}>{event.neighborhood}</span>
            )}
          </div>
        </div>

        {event.description && (
          <p className={styles.description}>{event.description}</p>
        )}

        {/* Footer */}
        <div className={styles.footer}>
          <span className={styles.source}>via {event.source}</span>
          {event.ticketUrl && (
            <a
              href={event.ticketUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`btn btn-primary ${styles.ctaBtn}`}
              id={`event-cta-${event.id}`}
              aria-label={`Ver mais sobre ${event.title}`}
            >
              {event.isFree ? 'Reservar' : 'Ingressos'} →
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

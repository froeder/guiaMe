import { useState } from 'react';
import type { EventCategory } from '../types/event';
import type { EventFilters } from '../types/event';
import { CATEGORY_CONFIG, ALL_CATEGORIES } from '../utils/categories';
import styles from './FilterBar.module.css';

interface FilterBarProps {
  filters: EventFilters;
  onChange: (f: EventFilters) => void;
  totalCount: number;
  filteredCount: number;
}

export function FilterBar({ filters, onChange, totalCount, filteredCount }: FilterBarProps) {
  const [showAllCategories, setShowAllCategories] = useState(false);

  const toggleCategory = (cat: EventCategory) => {
    const current = filters.categories;
    const next = current.includes(cat)
      ? current.filter((c) => c !== cat)
      : [...current, cat];
    onChange({ ...filters, categories: next });
  };

  const clearFilters = () => {
    onChange({ categories: [], priceFilter: 'all', searchQuery: '', selectedDate: null });
  };

  const hasActiveFilters =
    filters.categories.length > 0 ||
    filters.priceFilter !== 'all' ||
    filters.searchQuery !== '' ||
    filters.selectedDate !== null;

  const visibleCategories = showAllCategories ? ALL_CATEGORIES : ALL_CATEGORIES.slice(0, 8);

  return (
    <div className={styles.wrapper}>
      {/* Search */}
      <div className={styles.searchRow}>
        <div className={styles.searchBox}>
          <span className={styles.searchIcon}>🔍</span>
          <input
            id="search-events-input"
            type="search"
            className={styles.searchInput}
            placeholder="Buscar eventos, locais, bairros..."
            value={filters.searchQuery}
            onChange={(e) => onChange({ ...filters, searchQuery: e.target.value })}
            aria-label="Buscar eventos"
          />
          {filters.searchQuery && (
            <button
              className={styles.searchClear}
              onClick={() => onChange({ ...filters, searchQuery: '' })}
              aria-label="Limpar busca"
            >✕</button>
          )}
        </div>

        <div className={styles.resultCount}>
          <span className={styles.countNum}>{filteredCount}</span>
          <span className={styles.countLabel}>de {totalCount} eventos</span>
        </div>
      </div>

      {/* Price filter */}
      <div className={styles.priceRow}>
        <span className={styles.filterLabel}>💰 Valor:</span>
        <div className={styles.pillGroup} role="group" aria-label="Filtrar por valor">
          {(['all', 'free', 'paid'] as const).map((p) => (
            <button
              key={p}
              id={`price-filter-${p}`}
              className={`${styles.pill} ${filters.priceFilter === p ? styles.pillActive : ''}`}
              onClick={() => onChange({ ...filters, priceFilter: p })}
            >
              {p === 'all' && 'Todos'}
              {p === 'free' && '🎟️ Grátis'}
              {p === 'paid' && '💳 Pago'}
            </button>
          ))}
        </div>

        {hasActiveFilters && (
          <button className={styles.clearBtn} onClick={clearFilters} id="clear-filters-btn">
            ✕ Limpar filtros
          </button>
        )}
      </div>

      {/* Category chips */}
      <div className={styles.categoriesSection}>
        <span className={styles.filterLabel}>🗂️ Categorias:</span>
        <div className={styles.chips}>
          {visibleCategories.map((cat) => {
            const cfg = CATEGORY_CONFIG[cat];
            const isActive = filters.categories.includes(cat);
            return (
              <button
                key={cat}
                id={`category-chip-${cat}`}
                className={`${styles.chip} ${isActive ? styles.chipActive : ''}`}
                style={isActive ? { '--chip-color': cfg.color, '--chip-bg': cfg.bg } as React.CSSProperties : undefined}
                onClick={() => toggleCategory(cat)}
                aria-pressed={isActive}
              >
                <span>{cfg.emoji}</span>
                <span>{cfg.label}</span>
              </button>
            );
          })}
          {ALL_CATEGORIES.length > 8 && (
            <button
              className={styles.moreBtn}
              onClick={() => setShowAllCategories((v) => !v)}
              id="show-more-categories-btn"
            >
              {showAllCategories ? '← Menos' : `+${ALL_CATEGORIES.length - 8} mais`}
            </button>
          )}
        </div>
      </div>

      {/* Active filters summary */}
      {filters.categories.length > 0 && (
        <div className={styles.activeFilters}>
          <span className={styles.filterLabel}>Filtros ativos:</span>
          {filters.categories.map((cat) => (
            <span
              key={cat}
              className={styles.activeChip}
              style={{ '--chip-color': CATEGORY_CONFIG[cat].color } as React.CSSProperties}
            >
              {CATEGORY_CONFIG[cat].emoji} {CATEGORY_CONFIG[cat].label}
              <button
                className={styles.removeFilter}
                onClick={() => toggleCategory(cat)}
                aria-label={`Remover filtro ${CATEGORY_CONFIG[cat].label}`}
              >✕</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

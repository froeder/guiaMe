import { useState, useEffect, useCallback, useRef } from 'react';
import { format, addMonths, startOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { Event, EventFilters, EventCategory } from './types/event';
import { fetchAllEvents, filterEvents } from './services/eventService';
import { Header } from './components/Header';
import { FilterBar } from './components/FilterBar';
import { EventCalendar } from './components/EventCalendar';
import { EventCard } from './components/EventCard';
import { SkeletonGrid } from './components/SkeletonCard';
import styles from './App.module.css';

const DAILY_REFRESH_KEY = 'sp_eventos_last_daily_refresh';

function App() {
  const [allEvents, setAllEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [viewMonth, setViewMonth] = useState(new Date());
  const [filters, setFilters] = useState<EventFilters>({
    categories: [] as EventCategory[],
    priceFilter: 'all',
    searchQuery: '',
    selectedDate: null,
  });
  const [showCalendar, setShowCalendar] = useState(false);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 12;
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // ─── Load events ────────────────────────────────────────────────────────
  const loadEvents = useCallback(async (force = false) => {
    try {
      const events = await fetchAllEvents(force);
      setAllEvents(events);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Error loading events:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // ─── Daily refresh check ────────────────────────────────────────────────
  useEffect(() => {
    const lastRefresh = localStorage.getItem(DAILY_REFRESH_KEY);
    const today = new Date().toDateString();
    const shouldRefresh = !lastRefresh || lastRefresh !== today;

    loadEvents(shouldRefresh);

    if (shouldRefresh) {
      localStorage.setItem(DAILY_REFRESH_KEY, today);
    }
  }, [loadEvents]);

  // ─── Handle manual refresh ──────────────────────────────────────────────
  const handleRefresh = async () => {
    setRefreshing(true);
    await loadEvents(true);
  };

  // ─── Filtered events ────────────────────────────────────────────────────
  const filteredEvents = filterEvents(allEvents, filters);

  // Paginated
  const pagedEvents = filteredEvents.slice(0, page * PAGE_SIZE);
  const hasMore = pagedEvents.length < filteredEvents.length;

  // ─── Infinite scroll ────────────────────────────────────────────────────
  useEffect(() => {
    setPage(1);
  }, [filters]);

  useEffect(() => {
    if (!loadMoreRef.current || !hasMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) setPage((p) => p + 1);
      },
      { rootMargin: '200px' }
    );
    obs.observe(loadMoreRef.current);
    return () => obs.disconnect();
  }, [hasMore]);

  // ─── Group events by date for section headers ───────────────────────────
  // When a date is selected, bucket ALL matching events under that single date
  // so multi-day events don't get orphaned under their start date.
  const groupedEvents = pagedEvents.reduce((groups, event) => {
    const dateKey = filters.selectedDate
      ? `${filters.selectedDate.getFullYear()}-${String(filters.selectedDate.getMonth() + 1).padStart(2, '0')}-${String(filters.selectedDate.getDate()).padStart(2, '0')}`
      : event.date.slice(0, 10);
    if (!groups[dateKey]) groups[dateKey] = [];
    groups[dateKey].push(event);
    return groups;
  }, {} as Record<string, Event[]>);

  const sortedDateKeys = Object.keys(groupedEvents).sort();

  // ─── Month tabs (current + next) ────────────────────────────────────────
  const currentMonth = startOfMonth(new Date());
  const nextMonth = addMonths(currentMonth, 1);

  // ─── Featured events ─────────────────────────────────────────────────────
  const featuredEvents = allEvents.filter((e) => e.featured).slice(0, 5);

  return (
    <div className={styles.app}>
      <Header
        onRefresh={handleRefresh}
        isRefreshing={refreshing}
        lastUpdated={lastUpdated}
      />

      <main className={styles.main}>
        {/* ─── Hero / Featured carousel ──── */}
        {!loading && featuredEvents.length > 0 && filters.categories.length === 0 && !filters.selectedDate && !filters.searchQuery && (
          <section className={styles.featuredSection} aria-label="Eventos em destaque">
            <div className="container">
              <h2 className={styles.sectionTitle}>
                ⭐ <span className="gradient-text">Destaques</span>
              </h2>
              <div className={styles.featuredGrid}>
                {featuredEvents.map((event, i) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    style={{ animationDelay: `${i * 80}ms` }}
                  />
                ))}
              </div>
            </div>
          </section>
        )}

        <div className="container">
          <div className={styles.layout}>
            {/* ─── Sidebar ─── */}
            <aside className={styles.sidebar}>
              {/* Month tabs */}
              <div className={styles.monthTabs}>
                <button
                  id="month-tab-current"
                  className={`${styles.monthTab} ${viewMonth.getMonth() === currentMonth.getMonth() ? styles.monthTabActive : ''}`}
                  onClick={() => setViewMonth(currentMonth)}
                >
                  {format(currentMonth, 'MMMM', { locale: ptBR })}
                </button>
                <button
                  id="month-tab-next"
                  className={`${styles.monthTab} ${viewMonth.getMonth() === nextMonth.getMonth() ? styles.monthTabActive : ''}`}
                  onClick={() => setViewMonth(nextMonth)}
                >
                  {format(nextMonth, 'MMMM', { locale: ptBR })}
                </button>
              </div>

              {/* Calendar */}
              <EventCalendar
                events={allEvents}
                selectedDate={filters.selectedDate}
                onSelectDate={(date) => setFilters((f) => ({ ...f, selectedDate: date }))}
                viewMonth={viewMonth}
                onChangeMonth={setViewMonth}
              />

              {/* Stats */}
              <div className={styles.stats}>
                <div className={styles.stat}>
                  <span className={styles.statNum}>{allEvents.length}</span>
                  <span className={styles.statLabel}>Eventos</span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statNum}>
                    {allEvents.filter((e) => e.isFree).length}
                  </span>
                  <span className={styles.statLabel}>Gratuitos</span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statNum}>
                    {new Set(allEvents.map((e) => e.source)).size}
                  </span>
                  <span className={styles.statLabel}>Fontes</span>
                </div>
              </div>
            </aside>

            {/* ─── Main content ─── */}
            <div className={styles.content}>
              {/* Filter bar */}
              <FilterBar
                filters={filters}
                onChange={setFilters}
                totalCount={allEvents.length}
                filteredCount={filteredEvents.length}
              />

              {/* Mobile calendar toggle */}
              <button
                className={styles.calendarToggle}
                onClick={() => setShowCalendar((v) => !v)}
                id="mobile-calendar-toggle"
              >
                📅 {showCalendar ? 'Esconder calendário' : 'Ver calendário'}
              </button>

              {showCalendar && (
                <div className={styles.mobileCalendar}>
                  <div className={styles.monthTabs}>
                    <button
                      className={`${styles.monthTab} ${viewMonth.getMonth() === currentMonth.getMonth() ? styles.monthTabActive : ''}`}
                      onClick={() => setViewMonth(currentMonth)}
                    >
                      {format(currentMonth, 'MMMM', { locale: ptBR })}
                    </button>
                    <button
                      className={`${styles.monthTab} ${viewMonth.getMonth() === nextMonth.getMonth() ? styles.monthTabActive : ''}`}
                      onClick={() => setViewMonth(nextMonth)}
                    >
                      {format(nextMonth, 'MMMM', { locale: ptBR })}
                    </button>
                  </div>
                  <EventCalendar
                    events={allEvents}
                    selectedDate={filters.selectedDate}
                    onSelectDate={(date) => {
                      setFilters((f) => ({ ...f, selectedDate: date }));
                      if (date) setShowCalendar(false);
                    }}
                    viewMonth={viewMonth}
                    onChangeMonth={setViewMonth}
                  />
                </div>
              )}

              {/* Loading state */}
              {loading && <SkeletonGrid count={6} />}

              {/* Events list */}
              {!loading && (
                <>
                  {filteredEvents.length === 0 ? (
                    <div className={styles.empty}>
                      <div className={styles.emptyIcon}>🔍</div>
                      <h3 className={styles.emptyTitle}>Nenhum evento encontrado</h3>
                      <p className={styles.emptyDesc}>
                        Tente ajustar os filtros ou buscar por outra palavra-chave.
                      </p>
                      <button
                        className="btn btn-primary"
                        onClick={() => setFilters({ categories: [], priceFilter: 'all', searchQuery: '', selectedDate: null })}
                        id="empty-clear-filters-btn"
                      >
                        Limpar filtros
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* Grouped by date */}
                      {sortedDateKeys.map((dateKey) => {
                        const dayEvents = groupedEvents[dateKey];
                        const dateObj = new Date(dateKey + 'T12:00:00');
                        const dayLabel = format(dateObj, "EEEE, d 'de' MMMM", { locale: ptBR });

                        return (
                          <section key={dateKey} className={styles.dateGroup}>
                            <div className={styles.dateHeader}>
                              <div className={styles.dateLine} />
                              <h2 className={styles.dateLabel}>
                                📅 {dayLabel}
                              </h2>
                              <div className={styles.dateLine} />
                            </div>

                            <div className={styles.eventsGrid}>
                              {dayEvents.map((event, i) => (
                                <EventCard
                                  key={event.id}
                                  event={event}
                                  style={{ animationDelay: `${i * 50}ms` }}
                                />
                              ))}
                            </div>
                          </section>
                        );
                      })}

                      {/* Load more sentinel */}
                      {hasMore && (
                        <div ref={loadMoreRef} className={styles.loadMore}>
                          <div className={styles.loadMoreSpinner} />
                          <span>Carregando mais eventos...</span>
                        </div>
                      )}

                      {/* End of results */}
                      {!hasMore && filteredEvents.length > PAGE_SIZE && (
                        <p className={styles.endMessage}>
                          ✅ Todos os {filteredEvents.length} eventos exibidos
                        </p>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className="container">
          <p>
            <span className="gradient-text">GuiaMe SP</span> — Eventos em São Paulo
            &nbsp;·&nbsp; Fontes: Sympla, Eventbrite, Sampa.Art, Prefeitura SP, G1, Catraca Livre
          </p>
          <p className={styles.footerNote}>
            Dados atualizados diariamente. Mês atual e próximo mês.
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;

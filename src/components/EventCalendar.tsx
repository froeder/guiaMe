import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
  isToday,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { Event } from '../types/event';
import { CATEGORY_CONFIG } from '../utils/categories';
import styles from './EventCalendar.module.css';

interface EventCalendarProps {
  events: Event[];
  selectedDate: Date | null;
  onSelectDate: (date: Date | null) => void;
  viewMonth: Date;
  onChangeMonth: (date: Date) => void;
}

export function EventCalendar({
  events,
  selectedDate,
  onSelectDate,
  viewMonth,
  onChangeMonth,
}: EventCalendarProps) {
  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);
  const calStart = startOfWeek(monthStart, { locale: ptBR });
  const calEnd = endOfWeek(monthEnd, { locale: ptBR });

  // Build events map: date string -> events
  const eventsMap = new Map<string, Event[]>();
  events.forEach((e) => {
    const key = e.date.slice(0, 10);
    if (!eventsMap.has(key)) eventsMap.set(key, []);
    eventsMap.get(key)!.push(e);

    // Also register multi-day events
    if (e.endDate) {
      const start = new Date(e.date);
      const end = new Date(e.endDate);
      let cur = addDays(start, 1);
      while (cur <= end) {
        const k = format(cur, 'yyyy-MM-dd');
        if (!eventsMap.has(k)) eventsMap.set(k, []);
        eventsMap.get(k)!.push(e);
        cur = addDays(cur, 1);
      }
    }
  });

  // Build calendar grid
  const weeks: Date[][] = [];
  let day = calStart;
  while (day <= calEnd) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(day);
      day = addDays(day, 1);
    }
    weeks.push(week);
  }

  const weekDays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  const handleDayClick = (date: Date) => {
    if (!isSameMonth(date, viewMonth)) return;
    if (selectedDate && isSameDay(date, selectedDate)) {
      onSelectDate(null); // toggle off
    } else {
      onSelectDate(date);
    }
  };

  return (
    <div className={styles.calendar}>
      {/* Month navigation */}
      <div className={styles.monthNav}>
        <button
          className={styles.navBtn}
          onClick={() => onChangeMonth(subMonths(viewMonth, 1))}
          aria-label="Mês anterior"
          id="calendar-prev-month"
        >←</button>
        <h2 className={styles.monthTitle}>
          {format(viewMonth, 'MMMM yyyy', { locale: ptBR })}
        </h2>
        <button
          className={styles.navBtn}
          onClick={() => onChangeMonth(addMonths(viewMonth, 1))}
          aria-label="Próximo mês"
          id="calendar-next-month"
        >→</button>
      </div>

      {/* Weekday headers */}
      <div className={styles.weekdayRow}>
        {weekDays.map((d) => (
          <div key={d} className={styles.weekday}>{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className={styles.grid}>
        {weeks.map((week, wi) =>
          week.map((date, di) => {
            const key = format(date, 'yyyy-MM-dd');
            const dayEvents = eventsMap.get(key) || [];
            const isCurrentMonth = isSameMonth(date, viewMonth);
            const isSelected = selectedDate ? isSameDay(date, selectedDate) : false;
            const isTodayDate = isToday(date);
            const hasEvents = dayEvents.length > 0;

            // Get unique category colors for dots
            const uniqueCategories = [...new Set(dayEvents.map((e) => e.category))].slice(0, 3);

            return (
              <button
                key={`${wi}-${di}`}
                id={`calendar-day-${key}`}
                className={`
                  ${styles.day}
                  ${!isCurrentMonth ? styles.dayOtherMonth : ''}
                  ${isSelected ? styles.daySelected : ''}
                  ${isTodayDate ? styles.dayToday : ''}
                  ${hasEvents && isCurrentMonth ? styles.dayHasEvents : ''}
                `}
                onClick={() => handleDayClick(date)}
                aria-label={`${format(date, 'd MMMM', { locale: ptBR })}${hasEvents ? `, ${dayEvents.length} evento${dayEvents.length > 1 ? 's' : ''}` : ''}`}
                aria-pressed={isSelected}
                disabled={!isCurrentMonth}
              >
                <span className={styles.dayNumber}>{format(date, 'd')}</span>
                {hasEvents && isCurrentMonth && (
                  <div className={styles.dots}>
                    {uniqueCategories.map((cat) => (
                      <span
                        key={cat}
                        className={styles.dot}
                        style={{ background: CATEGORY_CONFIG[cat].color }}
                      />
                    ))}
                  </div>
                )}
                {hasEvents && isCurrentMonth && (
                  <span className={styles.eventCount}>{dayEvents.length}</span>
                )}
              </button>
            );
          })
        )}
      </div>

      {/* Selected date info */}
      {selectedDate && (
        <div className={styles.selectedInfo}>
          <span className={styles.selectedLabel}>
            📅 {format(selectedDate, "EEEE, d 'de' MMMM", { locale: ptBR })}
          </span>
          <button
            className={styles.clearDate}
            onClick={() => onSelectDate(null)}
            id="calendar-clear-date"
          >
            Limpar
          </button>
        </div>
      )}
    </div>
  );
}

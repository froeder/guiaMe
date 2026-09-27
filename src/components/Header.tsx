import styles from './Header.module.css';

interface HeaderProps {
  onRefresh: () => void;
  isRefreshing: boolean;
  lastUpdated: Date | null;
}

export function Header({ onRefresh, isRefreshing, lastUpdated }: HeaderProps) {
  const formatLastUpdated = (date: Date) => {
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000 / 60);
    if (diff < 1) return 'agora mesmo';
    if (diff < 60) return `há ${diff} min`;
    const hours = Math.floor(diff / 60);
    if (hours < 24) return `há ${hours}h`;
    return date.toLocaleDateString('pt-BR');
  };

  return (
    <header className={styles.header}>
      <div className="container">
        <div className={styles.inner}>
          <div className={styles.brand}>
            <div className={styles.logo}>
              <span className={styles.logoPin}>📍</span>
            </div>
            <div>
              <h1 className={styles.title}>
                <span className="gradient-text">GuiaMe</span>
                <span className={styles.titleSuffix}> SP</span>
              </h1>
              <p className={styles.subtitle}>Eventos em São Paulo</p>
            </div>
          </div>

          <div className={styles.right}>
            {lastUpdated && (
              <span className={styles.updateTime}>
                Atualizado {formatLastUpdated(lastUpdated)}
              </span>
            )}
            <button
              className={`btn btn-ghost ${styles.refreshBtn}`}
              onClick={onRefresh}
              disabled={isRefreshing}
              aria-label="Atualizar eventos"
              id="header-refresh-btn"
            >
              <span className={isRefreshing ? styles.spinning : ''}>🔄</span>
              <span className={styles.refreshLabel}>Atualizar</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

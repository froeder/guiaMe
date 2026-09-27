import styles from './SkeletonCard.module.css';

export function SkeletonCard() {
  return (
    <div className={styles.card} aria-hidden="true">
      <div className={`skeleton ${styles.image}`} />
      <div className={styles.content}>
        <div className={`skeleton ${styles.title}`} />
        <div className={`skeleton ${styles.titleShort}`} />
        <div className={`skeleton ${styles.meta}`} />
        <div className={`skeleton ${styles.meta}`} />
        <div className={`skeleton ${styles.desc}`} />
        <div className={`skeleton ${styles.desc}`} />
        <div className={`skeleton ${styles.descShort}`} />
      </div>
    </div>
  );
}

export function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className={styles.grid}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

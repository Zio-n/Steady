export function LoadingSkeleton({ label = 'Loading', lines = 3 }: { label?: string; lines?: number }) {
  return (
    <div className="loading-skeleton" role="status" aria-label={label}>
      {Array.from({ length: lines }, (_, index) => <span key={index} className={`skeleton-line skeleton-line-${index + 1}`} aria-hidden="true" />)}
      <span className="visually-hidden">{label}…</span>
    </div>
  );
}

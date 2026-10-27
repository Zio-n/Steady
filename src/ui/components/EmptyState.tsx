import type { ReactNode } from 'react';

type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
};

export function EmptyState({ icon, title, children, action }: EmptyStateProps) {
  return (
    <section className="empty-state" aria-label={title}>
      {icon}
      <h2>{title}</h2>
      <div className="empty-state-copy">{children}</div>
      {action}
    </section>
  );
}

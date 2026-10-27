import type { ReactNode } from 'react';

export function StatusMessage({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'success' | 'error' }) {
  return <div className={`status-message status-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>;
}

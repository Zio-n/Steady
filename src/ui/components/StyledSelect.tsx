import type { SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';

export function StyledSelect({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <span className="steady-select">
    <select {...props} className={`text-field ${className}`} />
    <ChevronDown size={15} aria-hidden="true" />
  </span>;
}

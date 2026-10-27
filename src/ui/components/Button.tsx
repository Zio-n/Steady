import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary';
  children: ReactNode;
};

export function Button({ variant = 'primary', className = '', children, ...props }: ButtonProps) {
  const variantClass = variant === 'primary' ? 'primary-button' : 'secondary-button';
  return <button className={`${variantClass}${className ? ` ${className}` : ''}`} {...props}>{children}</button>;
}

import type { InputHTMLAttributes, ReactNode } from 'react';

type FieldProps = {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
};

export function Field({ id, label, hint, error, children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="form-field">
      <label className="field-label" htmlFor={id}>{label}</label>
      {children}
      {hint && <p className="field-hint" id={hintId}>{hint}</p>}
      {error && <p className="field-error" id={errorId} role="alert">{error}</p>}
    </div>
  );
}

type NumericFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'id'> & {
  id: string;
  label: string;
  hint?: string;
  error?: string;
};

export function NumericField({ id, label, hint, error, ...inputProps }: NumericFieldProps) {
  const inputAriaInvalid = inputProps['aria-invalid'];
  const describedBy = [inputProps['aria-describedby'], hint && `${id}-hint`, error && `${id}-error`]
    .filter(Boolean).join(' ') || undefined;
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <input {...inputProps} id={id} type="number" className="text-field" aria-invalid={error ? true : inputAriaInvalid} aria-describedby={describedBy} />
    </Field>
  );
}

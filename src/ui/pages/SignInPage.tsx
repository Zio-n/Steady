import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Mail } from 'lucide-react';
import { z } from 'zod';
import { useAuth } from '../../app/AuthProvider';
import { requestEmailCode, verifyEmailCode, authErrorMessage } from '../../features/auth/authService';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { StatusMessage } from '../components/StatusMessage';

const emailSchema = z.string().trim().email();
const codeSchema = z.string().regex(/^\d{6}$/, 'Enter the six-digit code from your email.');

type SignInLocationState = { from?: string };

export function SignInPage() {
  const { status } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [resendUntil, setResendUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const secondsUntilResend = Math.max(0, Math.ceil((resendUntil - now) / 1000));

  useEffect(() => {
    if (resendUntil <= now) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [resendUntil, now]);

  if (status === 'signed-in') return <Navigate to="/onboarding" replace />;
  if (status === 'loading') return <main className="signin-page"><LoadingSkeleton label="Checking your session" /></main>;

  async function sendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage('');
    setInfoMessage('');
    const parsedEmail = emailSchema.safeParse(email);
    if (!parsedEmail.success) {
      setErrorMessage('Enter a valid email address to continue.');
      return;
    }

    setBusy(true);
    try {
      const normalisedEmail = parsedEmail.data.toLowerCase();
      await requestEmailCode(normalisedEmail);
      setEmail(normalisedEmail);
      setCode('');
      setStep('code');
      setResendUntil(Date.now() + 30_000);
      setNow(Date.now());
      setInfoMessage('If this email can sign in, a six-digit code has been sent. Check your inbox.');
    } catch (error) {
      setErrorMessage(authErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage('');
    setInfoMessage('');
    const parsedCode = codeSchema.safeParse(code);
    if (!parsedCode.success) {
      setErrorMessage('Enter the six-digit code from your email.');
      return;
    }

    setBusy(true);
    try {
      const result = await verifyEmailCode(email, parsedCode.data);
      const from = (location.state as SignInLocationState | null)?.from;
      if (!result.session) {
        setErrorMessage('The code was accepted, but Steady could not start your session. Please try signing in again.');
        return;
      }
      navigate(from || '/onboarding', { replace: true });
    } catch (error) {
      setErrorMessage(authErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    if (secondsUntilResend > 0 || busy) return;
    setBusy(true);
    setErrorMessage('');
    setInfoMessage('');
    try {
      await requestEmailCode(email);
      setResendUntil(Date.now() + 30_000);
      setNow(Date.now());
      setInfoMessage('A new code has been requested. Use the newest email; earlier codes may no longer work.');
    } catch (error) {
      setErrorMessage(authErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const unconfigured = status === 'unconfigured';

  return (
    <main className="signin-page">
      <Link to="/" className="back-link"><ArrowLeft size={16} /> Back to Steady</Link>
      <section className="signin-card" aria-labelledby="signin-title">
        <p className="eyebrow">A LITTLE MORE STEADY</p>
        <h1 id="signin-title">{step === 'email' ? 'Welcome back.' : 'Check your email.'}</h1>
        <p>{step === 'email' ? 'Sign in with a one-time code sent to your email.' : 'Enter the six-digit code sent to ' + email + '.'}</p>

        {unconfigured && <StatusMessage>Connect a Supabase project to enable secure sign-in. No account or personal data is being used in this local preview.</StatusMessage>}
        {errorMessage && <StatusMessage tone="error">{errorMessage}</StatusMessage>}
        {infoMessage && <StatusMessage>{infoMessage}</StatusMessage>}

        {step === 'email' ? (
          <form onSubmit={sendCode} noValidate>
            <Field id="email" label="Email address">
              <input className="text-field" id="email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} disabled={unconfigured || busy} />
            </Field>
            <Button className="full-width" type="submit" disabled={unconfigured || busy}><Mail size={17} /> {busy ? 'Sending code…' : 'Send me a code'}</Button>
          </form>
        ) : (
          <form onSubmit={verifyCode} noValidate>
            <Field id="code" label="Six-digit code" hint="The code is text so any leading zero stays in place.">
              <input className="text-field otp-field" id="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="000000" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} disabled={busy} autoFocus />
            </Field>
            <Button className="full-width" type="submit" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify code'}</Button>
            <div className="signin-secondary-actions">
              <Button variant="secondary" type="button" onClick={() => { setStep('email'); setCode(''); setErrorMessage(''); setInfoMessage(''); }} disabled={busy}>Use a different email</Button>
              <Button variant="secondary" type="button" onClick={resendCode} disabled={busy || secondsUntilResend > 0}>{secondsUntilResend > 0 ? 'Resend in ' + secondsUntilResend + 's' : 'Resend code'}</Button>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}


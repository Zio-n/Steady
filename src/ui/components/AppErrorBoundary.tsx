import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';

type Props = { children: ReactNode };
type State = { hasError: boolean };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled application rendering error', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return <main className="fatal-error"><AlertTriangle aria-hidden="true" /><h1>That didn’t load as expected.</h1><p>Your saved information has not been changed. Try reloading this page.</p><Button onClick={() => window.location.reload()}>Reload Steady</Button></main>;
  }
}

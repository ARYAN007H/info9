import React from 'react';
import { RotateCcw, ShieldAlert } from 'lucide-react';
import { Button } from './ui';

interface ErrorBoundaryProps {
  resetKey?: string;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message:
        error instanceof Error
          ? error.message
          : 'Unexpected rendering error in this module.',
    };
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, message: '' });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="rounded border border-danger/40 bg-panel p-6 text-center"
        >
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded border border-danger/30 bg-danger/10 text-danger">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <h2 className="text-sm font-semibold text-ink">
            Instrument encountered a display error
          </h2>
          <p className="mx-auto mt-1 max-w-md font-mono text-xs text-ink-3">
            {this.state.message}
          </p>
          <div className="mt-4">
            <Button
              size="sm"
              variant="primary"
              icon={<RotateCcw className="h-3.5 w-3.5" />}
              onClick={() => this.setState({ hasError: false, message: '' })}
            >
              Reload instrument
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

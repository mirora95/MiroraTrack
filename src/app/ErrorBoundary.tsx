import {
  Component,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "../components/Button";

interface ErrorBoundaryProps {
  readonly children: ReactNode;
  readonly onReload?: () => void;
}

interface ErrorBoundaryState {
  readonly failed: boolean;
  readonly retryKey: number;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { failed: false, retryKey: 0 };

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Deliberately avoid logging error details that may contain local paths.
  }

  private retry = () => {
    this.setState(({ retryKey }) => ({
      failed: false,
      retryKey: retryKey + 1,
    }));
  };

  private reload = () => {
    if (this.props.onReload) {
      this.props.onReload();
      return;
    }
    window.location.reload();
  };

  render() {
    if (!this.state.failed) {
      return <div key={this.state.retryKey}>{this.props.children}</div>;
    }
    return (
      <main className="recovery-page">
        <div className="recovery-page__panel" role="alert">
          <div className="recovery-page__icon">
            <ShieldCheck aria-hidden="true" />
          </div>
          <p className="eyebrow">Protected recovery</p>
          <h1>MiroraTrack needs to recover</h1>
          <p>
            The interface stopped unexpectedly. Your finance records remain
            stored locally and were not reset, deleted, or overwritten.
          </p>
          <p>Try the interface again, or reload the application safely.</p>
          <div className="settings-inline-actions">
            <Button onClick={this.retry}>Try again</Button>
            <Button variant="secondary" onClick={this.reload}>
              Reload MiroraTrack
            </Button>
          </div>
        </div>
      </main>
    );
  }
}


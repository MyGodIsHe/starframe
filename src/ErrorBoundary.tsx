import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { hasError: boolean };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // The fallback keeps the application intelligible when a renderer fails.
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return <SceneError message="The star map could not be rendered. Reload the page to try again." />;
    }

    return this.props.children;
  }
}

export function SceneError({ message }: { message: string }): ReactNode {
  return (
    <main className="scene-error" role="alert">
      <h1>Star map unavailable</h1>
      <p>{message}</p>
    </main>
  );
}

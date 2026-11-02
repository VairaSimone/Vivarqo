import { Component, type ErrorInfo, type ReactNode } from "react";
import type { Locale } from "../lib/domain";
import { ErrorState } from "./ui";

type Props = { children: ReactNode; locale: Locale };
type State = { failed: boolean };

/** Keeps a route render failure from crashing the entire application shell. */
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Vivarqo] A route failed to render.", error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      const message = this.props.locale === "it"
        ? "Questa schermata non è riuscita a caricarsi. Riprova o torna alla pagina precedente."
        : "This screen could not be loaded. Retry or return to the previous page.";
      return <ErrorState message={message} retry={() => window.location.reload()} />;
    }
    return this.props.children;
  }
}

import React, { Component, createContext, useContext } from "react";

import type { BrowserLogInstance } from "#tvzweoxg5ahk";

type LogProviderProps = {
  log: BrowserLogInstance;
  children?: React.ReactNode;
};

type LogErrorBoundaryProps = {
  log?: BrowserLogInstance;
  group?: string;
  metadata?: Record<string, unknown>;
  fallback?: React.ReactNode | ((error: Error) => React.ReactNode);
  children?: React.ReactNode;
};

type LogErrorBoundaryState = {
  error: Error | null;
};

const LogContext = createContext<BrowserLogInstance | null>(null);

function LogProvider({ log, children }: LogProviderProps) {
  return React.createElement(LogContext.Provider, { value: log }, children);
}

function useLog(groupName?: string): BrowserLogInstance | Record<string, any> {
  const log = useContext(LogContext);
  if (!log) throw new Error("missing-log-provider");
  return groupName ? log.group(groupName) : log;
}

class LogErrorBoundary extends Component<LogErrorBoundaryProps, LogErrorBoundaryState> {
  static contextType = LogContext;
  declare context: React.ContextType<typeof LogContext>;

  state: LogErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): LogErrorBoundaryState {
    return {
      error,
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    const logger = this.props.log || this.context;
    if (!logger) return;

    logger.logError(
      error,
      {
        ...(this.props.metadata || {}),
        group: this.props.group || "react.error_boundary",
        componentStack: info.componentStack,
      },
      "react",
    );
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    if (typeof this.props.fallback === "function") return this.props.fallback(this.state.error);
    return this.props.fallback ?? null;
  }
}

export { LogErrorBoundary, LogProvider, useLog };
export type { LogErrorBoundaryProps, LogProviderProps };

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { Buffer } from 'buffer';

if (typeof window !== 'undefined') {
  (window as any).Buffer = (window as any).Buffer || Buffer;
  (window as any).global = (window as any).global || window;
  (window as any).process = (window as any).process || { env: {} };
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class AppErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[AppErrorBoundary] Uncaught Error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0d0508] text-rose-300 p-6 flex flex-col justify-between font-mono max-w-md mx-auto border-x border-rose-950">
          <div className="space-y-4">
            <div className="p-4 bg-rose-950/40 rounded-xl border border-rose-800/80">
              <h1 className="text-base font-bold text-rose-400 uppercase tracking-wider mb-1">
                ⚠️ Аварийная остановка UI
              </h1>
              <p className="text-xs text-rose-200/80">
                В процессе рендеринга интерфейса React произошел фатальный сбой.
              </p>
            </div>

            <div className="bg-[#180a0e] p-3 rounded-xl border border-rose-900/60 space-y-2 text-xs">
              <div className="text-rose-400 font-bold">Детали ошибки:</div>
              <div className="text-rose-200 break-words bg-[#0e0406] p-2 rounded border border-rose-950 text-[11px]">
                {this.state.error?.message || 'Неизвестная ошибка рендеринга'}
              </div>

              {this.state.errorInfo?.componentStack && (
                <>
                  <div className="text-rose-400 font-bold pt-2">Стек компонентов:</div>
                  <pre className="text-[10px] text-rose-300/70 overflow-x-auto whitespace-pre-wrap max-h-40 bg-[#0e0406] p-2 rounded border border-rose-950">
                    {this.state.errorInfo.componentStack}
                  </pre>
                </>
              )}
            </div>
          </div>

          <button
            onClick={() => window.location.reload()}
            className="w-full py-3 bg-rose-600 hover:bg-rose-500 active:scale-[0.99] text-white font-bold rounded-xl transition-all cursor-pointer shadow-lg shadow-rose-950/50 mt-6 tracking-wider uppercase text-xs"
          >
            Перезагрузить приложение
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);

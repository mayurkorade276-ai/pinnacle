import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message || 'An unexpected error occurred.' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Pinnacle ErrorBoundary caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F5F6F8] flex items-center justify-center p-4">
          <div className="bg-white border border-[#E2E6EC] rounded-md p-6 max-w-md w-full space-y-3">
            <h1 className="text-lg font-semibold text-[#111827]">Something went wrong</h1>
            <p className="text-sm text-[#4B5563]">
              We encountered an error loading this view. Please reload the page to continue.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-[#1F5FA8] text-white text-sm font-medium rounded hover:bg-[#184C87]"
            >
              Reload Pinnacle
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

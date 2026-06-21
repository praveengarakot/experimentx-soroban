import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient();

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // Deprecated
    removeListener: vi.fn(), // Deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
  useQuery: () => ({ data: null, isLoading: false }),
  useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  QueryClient: vi.fn(),
  QueryClientProvider: ({ children }) => <div>{children}</div>,
}));

describe('App', () => {
  it('renders the connection button', () => {
    render(<App />);
    expect(screen.getByText(/Connect Wallet/i)).toBeDefined();
  });
});

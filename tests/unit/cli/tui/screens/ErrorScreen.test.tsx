/**
 * Tests for the ErrorScreen component.
 *
 * The ErrorScreen:
 * 1. Displays error message and stack trace
 * 2. Shows keyboard hints for retry and quit
 * 3. Responds to keyboard input
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ErrorScreen } from '@/cli/tui/screens/ErrorScreen.js';

describe('ErrorScreen', () => {
  const mockError = new Error('Something went wrong');
  mockError.stack = `Error: Something went wrong
    at SomeFunction (file.js:1:1)
    at AnotherFunction (file.js:2:2)
    at YetAnother (file.js:3:3)
    at More (file.js:4:4)`;

  it('should display error message', () => {
    const { lastFrame } = render(
      <ErrorScreen error={mockError} onRetry={vi.fn()} onQuit={vi.fn()} />
    );

    expect(lastFrame()).toContain('Something went wrong');
  });

  it('should display error header', () => {
    const { lastFrame } = render(
      <ErrorScreen error={mockError} onRetry={vi.fn()} onQuit={vi.fn()} />
    );

    expect(lastFrame()).toContain('An error occurred');
  });

  it('should display retry hint', () => {
    const { lastFrame } = render(
      <ErrorScreen error={mockError} onRetry={vi.fn()} onQuit={vi.fn()} />
    );

    expect(lastFrame()).toContain('r');
    expect(lastFrame()).toContain('retry');
  });

  it('should display quit hint', () => {
    const { lastFrame } = render(
      <ErrorScreen error={mockError} onRetry={vi.fn()} onQuit={vi.fn()} />
    );

    expect(lastFrame()).toContain('q');
    expect(lastFrame()).toContain('quit');
  });

  it('should display partial stack trace', () => {
    const { lastFrame } = render(
      <ErrorScreen error={mockError} onRetry={vi.fn()} onQuit={vi.fn()} />
    );

    // Should show some stack trace lines
    expect(lastFrame()).toContain('at SomeFunction');
  });

  // Note: Keyboard input tests are skipped because ink-testing-library
  // doesn't fully support useInput hook testing in non-interactive mode.
  // The keyboard handling is tested via manual integration testing.

  it('should handle error without stack trace', () => {
    const errorWithoutStack = new Error('Simple error');
    delete errorWithoutStack.stack;

    const { lastFrame } = render(
      <ErrorScreen error={errorWithoutStack} onRetry={vi.fn()} onQuit={vi.fn()} />
    );

    expect(lastFrame()).toContain('Simple error');
    // Should still render without crashing
    expect(lastFrame()).toContain('retry');
  });
});

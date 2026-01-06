/**
 * Tests for the KeyHints component.
 *
 * The KeyHints component:
 * 1. Displays keyboard shortcuts with their labels
 * 2. Separates hints with vertical bars
 * 3. Handles empty hint arrays
 */

import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { KeyHints } from '@/cli/tui/components/KeyHints.js';

describe('KeyHints', () => {
  it('should render a single hint', () => {
    const hints = [{ key: 'q', label: 'quit' }];
    const { lastFrame } = render(<KeyHints hints={hints} />);

    expect(lastFrame()).toContain('q');
    expect(lastFrame()).toContain('quit');
  });

  it('should render multiple hints', () => {
    const hints = [
      { key: 'r', label: 'retry' },
      { key: 'q', label: 'quit' },
    ];
    const { lastFrame } = render(<KeyHints hints={hints} />);

    expect(lastFrame()).toContain('r');
    expect(lastFrame()).toContain('retry');
    expect(lastFrame()).toContain('q');
    expect(lastFrame()).toContain('quit');
  });

  it('should separate hints with vertical bars', () => {
    const hints = [
      { key: 'r', label: 'retry' },
      { key: 'q', label: 'quit' },
    ];
    const { lastFrame } = render(<KeyHints hints={hints} />);

    expect(lastFrame()).toContain('│');
  });

  it('should not show separator for single hint', () => {
    const hints = [{ key: 'q', label: 'quit' }];
    const { lastFrame } = render(<KeyHints hints={hints} />);
    const frame = lastFrame();

    // Should have the horizontal line separator but not vertical bar between hints
    expect(frame).toContain('─');
    // Single hint should not have │ separator between hints
    // (the only │ would be in the horizontal line if present)
    const hintLine = frame?.split('\n').find((line) => line.includes('q') && line.includes('quit'));
    expect(hintLine).not.toContain('│');
  });

  it('should render empty hints array without error', () => {
    const hints: Array<{ key: string; label: string }> = [];
    const { lastFrame } = render(<KeyHints hints={hints} />);

    // Should render the separator line at minimum
    expect(lastFrame()).toContain('─');
  });

  it('should display three hints correctly', () => {
    const hints = [
      { key: '↑/↓', label: 'scroll' },
      { key: 's', label: 'save' },
      { key: 'q', label: 'quit' },
    ];
    const { lastFrame } = render(<KeyHints hints={hints} />);
    const frame = lastFrame();

    expect(frame).toContain('↑/↓');
    expect(frame).toContain('scroll');
    expect(frame).toContain('s');
    expect(frame).toContain('save');
    expect(frame).toContain('q');
    expect(frame).toContain('quit');
  });

  it('should render separator line', () => {
    const hints = [{ key: 'q', label: 'quit' }];
    const { lastFrame } = render(<KeyHints hints={hints} />);

    // Should have horizontal separator line made of '─' characters
    expect(lastFrame()).toContain('─'.repeat(10));
  });
});

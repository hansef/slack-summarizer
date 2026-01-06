/**
 * Tests for the Header component.
 *
 * The Header:
 * 1. Displays the app title
 * 2. Shows the current screen name
 * 3. Renders a separator line
 */

import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { Header } from '@/cli/tui/components/Header.js';
import type { Screen } from '@/cli/tui/types.js';

describe('Header', () => {
  it('should render the app title', () => {
    const { lastFrame } = render(<Header screen="setup" />);
    expect(lastFrame()).toContain('Slack Summarizer');
  });

  it('should display setup screen title', () => {
    const { lastFrame } = render(<Header screen="setup" />);
    expect(lastFrame()).toContain('Setup');
  });

  it('should display date-selection screen title', () => {
    const { lastFrame } = render(<Header screen="date-selection" />);
    expect(lastFrame()).toContain('Select Date');
  });

  it('should display loading screen title', () => {
    const { lastFrame } = render(<Header screen="loading" />);
    expect(lastFrame()).toContain('Generating Summary');
  });

  it('should display summary screen title', () => {
    const { lastFrame } = render(<Header screen="summary" />);
    expect(lastFrame()).toContain('Summary');
  });

  it('should display settings screen title', () => {
    const { lastFrame } = render(<Header screen="settings" />);
    expect(lastFrame()).toContain('Settings');
  });

  it('should display error screen title', () => {
    const { lastFrame } = render(<Header screen="error" />);
    expect(lastFrame()).toContain('Error');
  });

  it('should contain a separator line', () => {
    const { lastFrame } = render(<Header screen="setup" />);
    // The separator is made of '─' characters
    expect(lastFrame()).toContain('─');
  });

  it.each([
    ['setup', 'Setup'],
    ['date-selection', 'Select Date'],
    ['loading', 'Generating Summary'],
    ['summary', 'Summary'],
    ['settings', 'Settings'],
    ['error', 'Error'],
  ] as [Screen, string][])('should render %s screen correctly', (screen, expectedTitle) => {
    const { lastFrame } = render(<Header screen={screen} />);
    const frame = lastFrame();
    expect(frame).toContain('Slack Summarizer');
    expect(frame).toContain(expectedTitle);
    expect(frame).toContain('─');
  });
});

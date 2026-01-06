/**
 * Tests for file-save utilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DateTime } from 'luxon';

// Mock fs using vi.hoisted to avoid temporal dead zone
const { mockWriteFileSync } = vi.hoisted(() => ({
  mockWriteFileSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  writeFileSync: mockWriteFileSync,
}));

// Mock path.resolve to return predictable paths
vi.mock('node:path', () => ({
  resolve: (dir: string, file: string) => `${dir}/${file}`,
}));

import {
  generateFilename,
  saveSummaryToFile,
  formatPathForDisplay,
} from '@/cli/tui/utils/file-save.js';

describe('file-save utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateFilename', () => {
    it('should generate filename for single day', () => {
      const dateRange = {
        start: DateTime.fromISO('2024-01-15'),
        end: DateTime.fromISO('2024-01-15'),
      };

      const filename = generateFilename(dateRange);

      expect(filename).toBe('slack-summary-2024-01-15.md');
    });

    it('should generate filename for date range', () => {
      const dateRange = {
        start: DateTime.fromISO('2024-01-01'),
        end: DateTime.fromISO('2024-01-07'),
      };

      const filename = generateFilename(dateRange);

      expect(filename).toBe('slack-summary-2024-01-01_2024-01-07.md');
    });

    it('should handle month and year boundaries', () => {
      const dateRange = {
        start: DateTime.fromISO('2023-12-25'),
        end: DateTime.fromISO('2024-01-02'),
      };

      const filename = generateFilename(dateRange);

      expect(filename).toBe('slack-summary-2023-12-25_2024-01-02.md');
    });
  });

  describe('saveSummaryToFile', () => {
    const originalCwd = process.cwd.bind(process);

    beforeEach(() => {
      process.cwd = vi.fn().mockReturnValue('/home/user/projects');
    });

    afterEach(() => {
      process.cwd = originalCwd;
    });

    it('should write content to file and return path', () => {
      const content = '# Summary\n\nContent here';
      const dateRange = {
        start: DateTime.fromISO('2024-01-15'),
        end: DateTime.fromISO('2024-01-15'),
      };

      const filepath = saveSummaryToFile(content, dateRange);

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('slack-summary-2024-01-15.md'),
        content,
        'utf-8'
      );
      expect(filepath).toContain('slack-summary-2024-01-15.md');
    });

    it('should use date range filename for multiple days', () => {
      const content = '# Summary';
      const dateRange = {
        start: DateTime.fromISO('2024-01-01'),
        end: DateTime.fromISO('2024-01-05'),
      };

      saveSummaryToFile(content, dateRange);

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('slack-summary-2024-01-01_2024-01-05.md'),
        content,
        'utf-8'
      );
    });
  });

  describe('formatPathForDisplay', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should replace HOME with tilde', () => {
      process.env.HOME = '/home/testuser';

      const result = formatPathForDisplay('/home/testuser/documents/file.md');

      expect(result).toBe('~/documents/file.md');
    });

    it('should replace USERPROFILE with tilde on Windows', () => {
      delete process.env.HOME;
      process.env.USERPROFILE = 'C:\\Users\\testuser';

      const result = formatPathForDisplay('C:\\Users\\testuser\\documents\\file.md');

      expect(result).toBe('~\\documents\\file.md');
    });

    it('should return path unchanged if not in home directory', () => {
      process.env.HOME = '/home/testuser';

      const result = formatPathForDisplay('/var/log/file.log');

      expect(result).toBe('/var/log/file.log');
    });

    it('should return path unchanged if no home env vars', () => {
      delete process.env.HOME;
      delete process.env.USERPROFILE;

      const result = formatPathForDisplay('/some/path/file.txt');

      expect(result).toBe('/some/path/file.txt');
    });
  });
});

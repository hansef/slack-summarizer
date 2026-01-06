import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { output } from '@/cli/output.js';

describe('CLI Output', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('info', () => {
    it('should print info message', () => {
      output.info('Test message');
      expect(consoleLogSpy).toHaveBeenCalled();
      const call = consoleLogSpy.mock.calls[0][0];
      expect(call).toContain('Test message');
    });
  });

  describe('success', () => {
    it('should print success message', () => {
      output.success('Success message');
      expect(consoleLogSpy).toHaveBeenCalled();
      const call = consoleLogSpy.mock.calls[0][0];
      expect(call).toContain('Success message');
    });
  });

  describe('warn', () => {
    it('should print warning message', () => {
      output.warn('Warning message');
      expect(consoleLogSpy).toHaveBeenCalled();
      const call = consoleLogSpy.mock.calls[0][0];
      expect(call).toContain('Warning message');
    });
  });

  describe('error', () => {
    it('should print error message', () => {
      output.error('Error message');
      expect(consoleErrorSpy).toHaveBeenCalled();
      const call = consoleErrorSpy.mock.calls[0][0];
      expect(call).toContain('Error message');
    });

    it('should print error details when provided', () => {
      output.error('Error message', 'Details here');
      expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('progress', () => {
    it('should print progress message', () => {
      output.progress('Loading...');
      expect(consoleLogSpy).toHaveBeenCalled();
      const call = consoleLogSpy.mock.calls[0][0];
      expect(call).toContain('Loading...');
    });
  });

  describe('header', () => {
    it('should print header with bold formatting', () => {
      output.header('Test Header');
      expect(consoleLogSpy).toHaveBeenCalled();
      const call = consoleLogSpy.mock.calls[0][0];
      expect(call).toContain('Test Header');
    });
  });

  describe('divider', () => {
    it('should print horizontal divider', () => {
      output.divider();
      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });

  describe('stat', () => {
    it('should print labeled statistic', () => {
      output.stat('Count', 42);
      expect(consoleLogSpy).toHaveBeenCalled();
      const call = consoleLogSpy.mock.calls[0][0];
      expect(call).toContain('Count');
      expect(call).toContain('42');
    });

    it('should handle string values', () => {
      output.stat('Label', 'value');
      expect(consoleLogSpy).toHaveBeenCalled();
      const call = consoleLogSpy.mock.calls[0][0];
      expect(call).toContain('value');
    });
  });

  describe('channelSummary', () => {
    it('should print channel summary', () => {
      output.channelSummary('general', 10, 3);
      expect(consoleLogSpy).toHaveBeenCalled();
      const call = consoleLogSpy.mock.calls[0][0];
      expect(call).toContain('#general');
      expect(call).toContain('10 interactions');
      expect(call).toContain('3 conversations');
    });
  });

  describe('raw', () => {
    it('should print raw text', () => {
      output.raw('Raw text');
      expect(consoleLogSpy).toHaveBeenCalledWith('Raw text');
    });
  });

  describe('json', () => {
    it('should print formatted JSON', () => {
      const data = { key: 'value' };
      output.json(data);
      expect(consoleLogSpy).toHaveBeenCalled();
      const call = consoleLogSpy.mock.calls[0][0];
      expect(call).toContain('"key"');
      expect(call).toContain('"value"');
    });
  });
});

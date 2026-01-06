import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { logger } from '@/utils/logger.js';
import { resetEnvCache } from '@/utils/env.js';

describe('logger', () => {
  const originalEnv = process.env;
  const originalIsTTY = process.stdout.isTTY;
  let consoleSpy: MockInstance;
  let errorSpy: MockInstance;

  beforeEach(() => {
    resetEnvCache();
    process.env = { ...originalEnv };
    process.env.SLACK_USER_TOKEN = 'xoxp-test-token';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    // Force non-TTY for consistent JSON output in tests
    Object.defineProperty(process.stdout, 'isTTY', { value: false, writable: true });
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, writable: true });
    resetEnvCache();
    vi.restoreAllMocks();
  });

  describe('log levels', () => {
    it('should log info messages when level is info', () => {
      process.env.SLACK_SUMMARIZER_LOG_LEVEL = 'info';
      resetEnvCache();

      logger.info('test message');

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const logOutput = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(logOutput) as { level: string; message: string };
      expect(parsed.level).toBe('info');
      expect(parsed.message).toBe('test message');
    });

    it('should not log debug messages when level is info', () => {
      process.env.SLACK_SUMMARIZER_LOG_LEVEL = 'info';
      resetEnvCache();

      logger.debug('debug message');

      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('should log debug messages when level is debug', () => {
      process.env.SLACK_SUMMARIZER_LOG_LEVEL = 'debug';
      resetEnvCache();

      logger.debug('debug message');

      expect(consoleSpy).toHaveBeenCalledTimes(1);
    });

    it('should log warn messages when level is info', () => {
      process.env.SLACK_SUMMARIZER_LOG_LEVEL = 'info';
      resetEnvCache();

      logger.warn('warning message');

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const logOutput = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(logOutput) as { level: string };
      expect(parsed.level).toBe('warn');
    });

    it('should log error messages to stderr', () => {
      process.env.SLACK_SUMMARIZER_LOG_LEVEL = 'info';
      resetEnvCache();

      logger.error('error message');

      expect(errorSpy).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const logOutput = errorSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(logOutput) as { level: string };
      expect(parsed.level).toBe('error');
    });

    it('should only log error when level is error', () => {
      process.env.SLACK_SUMMARIZER_LOG_LEVEL = 'error';
      resetEnvCache();

      logger.debug('debug');
      logger.info('info');
      logger.warn('warn');
      logger.error('error');

      expect(consoleSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('context', () => {
    it('should include context in log output', () => {
      process.env.SLACK_SUMMARIZER_LOG_LEVEL = 'info';
      resetEnvCache();

      logger.info('test message', { key: 'value', count: 42 });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const logOutput = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(logOutput) as { context: { key: string; count: number } };
      expect(parsed.context).toEqual({ key: 'value', count: 42 });
    });

    it('should not include context key when not provided', () => {
      process.env.SLACK_SUMMARIZER_LOG_LEVEL = 'info';
      resetEnvCache();

      logger.info('test message');

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const logOutput = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(logOutput) as { context?: unknown };
      expect(parsed.context).toBeUndefined();
    });
  });

  describe('timestamp', () => {
    it('should include ISO timestamp in log output', () => {
      process.env.SLACK_SUMMARIZER_LOG_LEVEL = 'info';
      resetEnvCache();

      logger.info('test message');

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const logOutput = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(logOutput) as { timestamp: string };
      expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });
});

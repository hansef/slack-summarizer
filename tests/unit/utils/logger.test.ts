import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetEnvCache } from '@/utils/env.js';

// We need to reset modules between tests to pick up log level changes
describe('logger', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    resetEnvCache();
    process.env = { ...originalEnv };
    process.env.SLACK_USER_TOKEN = 'xoxp-test-token';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
  });

  afterEach(() => {
    process.env = originalEnv;
    resetEnvCache();
    vi.restoreAllMocks();
  });

  describe('createLogger', () => {
    it('should create a child logger with component binding', async () => {
      const { createLogger, resetLogger } = await import('@/utils/logging/index.js');
      resetLogger();

      const componentLogger = createLogger({ component: 'TestComponent' });

      // Child logger should have the bindings attached
      expect(componentLogger).toBeDefined();
      expect(typeof componentLogger.info).toBe('function');
      expect(typeof componentLogger.debug).toBe('function');
      expect(typeof componentLogger.warn).toBe('function');
      expect(typeof componentLogger.error).toBe('function');
    });
  });

  describe('setSilent and isSilent', () => {
    it('should set and get silent mode', async () => {
      const { setSilent, isSilent, resetLogger } = await import('@/utils/logging/index.js');
      resetLogger();

      expect(isSilent()).toBe(false);

      setSilent(true);
      expect(isSilent()).toBe(true);

      setSilent(false);
      expect(isSilent()).toBe(false);
    });
  });

  describe('setLevel and getLevel', () => {
    it('should set and get log level', async () => {
      const { setLevel, getLevel, resetLogger } = await import('@/utils/logging/index.js');
      resetLogger();

      // Default level from env or 'info'
      setLevel('debug');
      expect(getLevel()).toBe('debug');

      setLevel('warn');
      expect(getLevel()).toBe('warn');
    });
  });

  describe('ProgressReporter', () => {
    it('should track active state', async () => {
      const { getProgressReporter, resetProgressReporter } = await import(
        '@/utils/logging/index.js'
      );
      resetProgressReporter();

      const progress = getProgressReporter();

      expect(progress.isActive()).toBe(false);

      progress.start();
      expect(progress.isActive()).toBe(true);

      progress.stop();
      expect(progress.isActive()).toBe(false);
    });

    it('should be a singleton', async () => {
      const { getProgressReporter, resetProgressReporter } = await import(
        '@/utils/logging/index.js'
      );
      resetProgressReporter();

      const progress1 = getProgressReporter();
      const progress2 = getProgressReporter();

      expect(progress1).toBe(progress2);
    });
  });

  describe('Timer', () => {
    it('should track timing labels', async () => {
      const { createLogger, createTimer, resetLogger } = await import('@/utils/logging/index.js');
      resetLogger();

      const testLogger = createLogger({ component: 'TimerTest' });
      const timer = createTimer(testLogger);

      // Should not throw when starting/ending timers
      timer.start('test-operation');
      timer.end('test-operation');
    });

    it('should support timed async operations', async () => {
      const { createLogger, createTimer, resetLogger } = await import('@/utils/logging/index.js');
      resetLogger();

      const testLogger = createLogger({ component: 'TimerTest' });
      const timer = createTimer(testLogger);

      const result = await timer.timed('async-op', () => {
        return Promise.resolve('completed');
      });

      expect(result).toBe('completed');
    });
  });
});

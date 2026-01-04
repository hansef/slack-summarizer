import { z } from 'zod';

export const SummarizationConfigSchema = z.object({
  model: z.enum(['claude-haiku-4-5-20251001', 'claude-sonnet-4-5-20250929']),
  apiKey: z.string(),
});

export type SummarizationConfig = z.infer<typeof SummarizationConfigSchema>;

export const SegmentationConfigSchema = z.object({
  gapThresholdMinutes: z.number().default(30),
  timezone: z.string().default('America/Los_Angeles'),
});

export type SegmentationConfig = z.infer<typeof SegmentationConfigSchema>;

export const FetcherConfigSchema = z.object({
  slackToken: z.string(),
  rateLimitPerSecond: z.number().default(1),
  maxRetries: z.number().default(5),
  pageSize: z.number().default(200),
});

export type FetcherConfig = z.infer<typeof FetcherConfigSchema>;

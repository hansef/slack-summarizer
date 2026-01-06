/**
 * Custom Pino serializers for structured logging.
 */

/**
 * Error serializer that captures full error details including stack traces
 * and any custom properties attached to the error object.
 */
export function errorSerializer(err: Error): Record<string, unknown> {
  return {
    type: err.constructor.name,
    message: err.message,
    stack: err.stack,
    // Include any custom properties (e.g., `code`, `status`, etc.)
    ...(err as unknown as Record<string, unknown>),
  };
}

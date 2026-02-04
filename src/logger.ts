/**
 * Structured logger for Checkmate MCP Server
 *
 * Uses pino for fast, JSON-native logging suitable for enterprise log aggregation.
 *
 * Log levels:
 * - fatal: System is unusable
 * - error: Error conditions
 * - warn:  Warning conditions
 * - info:  Normal operational messages
 * - debug: Debug-level messages
 * - trace: Very detailed tracing
 *
 * Environment variables:
 * - LOG_LEVEL: Set minimum log level (default: "info")
 * - LOG_PRETTY: Set to "true" for human-readable output in development
 */

import pino from "pino";

const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const LOG_PRETTY = process.env.LOG_PRETTY === "true";

// Base logger configuration
const baseConfig: pino.LoggerOptions = {
  level: LOG_LEVEL,
  base: {
    service: "checkmate-mcp",
    version: "1.0.0",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
};

// Create logger with optional pretty printing for development
const transport = LOG_PRETTY
  ? {
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname,service,version",
        },
      },
    }
  : {};

export const logger = pino({
  ...baseConfig,
  ...transport,
});

// Child loggers for different components
export const serverLogger = logger.child({ component: "server" });
export const toolLogger = logger.child({ component: "tool" });
export const apiLogger = logger.child({ component: "api" });
export const resourceLogger = logger.child({ component: "resource" });

// Helper for creating request-scoped loggers
export function createRequestLogger(requestId: string) {
  return logger.child({ requestId });
}

// Helper for logging tool calls with context
export function logToolCall(
  toolName: string,
  params: Record<string, unknown>,
  extra?: Record<string, unknown>
) {
  toolLogger.info({ tool: toolName, params, ...extra }, `Tool called: ${toolName}`);
}

// Helper for logging tool results
export function logToolResult(
  toolName: string,
  success: boolean,
  durationMs?: number,
  extra?: Record<string, unknown>
) {
  const level = success ? "info" : "error";
  toolLogger[level](
    { tool: toolName, success, durationMs, ...extra },
    `Tool ${success ? "completed" : "failed"}: ${toolName}`
  );
}

export default logger;

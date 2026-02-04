/**
 * Checkmate MCP Server
 *
 * Exposes Checkmate test execution capabilities via MCP protocol with rich UI.
 *
 * Tools:
 * - list_projects: List all Checkmate projects (with fancy UI)
 * - list_test_cases: List test cases in a project
 * - run_test: Execute a test case by ID (with real-time UI)
 * - run_natural_test: Execute a test from natural language (with real-time UI)
 */

import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { readFileSync } from "fs";
import { z } from "zod";
import { CheckmateClient } from "./src/checkmate-client.js";
import { serverLogger, toolLogger, resourceLogger, apiLogger } from "./src/logger.js";
import type { SSEEvent, TestStep } from "./src/types.js";

serverLogger.info("Starting Checkmate MCP Server...");

// =============================================================================
// Configuration
// =============================================================================

const PORT = process.env.PORT || 3003;
const CHECKMATE_URL = process.env.CHECKMATE_URL || "http://127.0.0.1:8000";

const client = new CheckmateClient(CHECKMATE_URL);

// =============================================================================
// Load UI HTML Files
// =============================================================================

function loadUI(filename: string): string {
  try {
    const html = readFileSync(`./ui/${filename}`, "utf-8");
    serverLogger.debug({ filename }, "Loaded UI file");
    return html;
  } catch (e) {
    serverLogger.error({ filename, error: e }, "Failed to load UI file");
    return `<!DOCTYPE html><html><body><h1>UI not found: ${filename}</h1></body></html>`;
  }
}

const PROJECTS_UI = loadUI("projects.html");
const TEST_CASES_UI = loadUI("test-cases.html");
const TEST_RUNNER_UI = loadUI("test-runner.html");

// =============================================================================
// MCP Server Setup
// =============================================================================

const server = new McpServer({
  name: "checkmate-mcp",
  version: "1.0.0",
});

// =============================================================================
// UI Resources
// =============================================================================

const PROJECTS_UI_URI = "ui://checkmate-mcp/projects";
const TEST_CASES_UI_URI = "ui://checkmate-mcp/test-cases";
const TEST_RUNNER_UI_URI = "ui://checkmate-mcp/test-runner";

server.resource("projects-ui", PROJECTS_UI_URI, {
  description: "Projects listing UI",
  mimeType: "text/html;profile=mcp-app",
}, async (uri) => {
  resourceLogger.debug({ uri: uri.href }, "Serving projects UI");
  return {
    contents: [{
      uri: uri.href,
      mimeType: "text/html;profile=mcp-app",
      text: PROJECTS_UI,
      _meta: { ui: { csp: {}, prefersBorder: false } },
    }],
  };
});

server.resource("test-cases-ui", TEST_CASES_UI_URI, {
  description: "Test cases listing UI with run actions",
  mimeType: "text/html;profile=mcp-app",
}, async (uri) => {
  resourceLogger.debug({ uri: uri.href }, "Serving test-cases UI");
  return {
    contents: [{
      uri: uri.href,
      mimeType: "text/html;profile=mcp-app",
      text: TEST_CASES_UI,
      _meta: { ui: { csp: {}, prefersBorder: false } },
    }],
  };
});

server.resource("test-runner-ui", TEST_RUNNER_UI_URI, {
  description: "Test execution UI with real-time progress",
  mimeType: "text/html;profile=mcp-app",
}, async (uri) => {
  resourceLogger.debug({ uri: uri.href }, "Serving test-runner UI");
  return {
    contents: [{
      uri: uri.href,
      mimeType: "text/html;profile=mcp-app",
      text: TEST_RUNNER_UI,
      _meta: { ui: { csp: { "connect-src": "http://127.0.0.1:3003" }, prefersBorder: false } },
    }],
  };
});

// =============================================================================
// Tool: list_projects
// =============================================================================

server.registerTool(
  "list_projects",
  {
    description: "List all Checkmate projects. Shows project names, URLs, and test counts in a visual card grid.",
    inputSchema: {},
    _meta: {
      ui: {
        resourceUri: PROJECTS_UI_URI,
        visibility: ["model", "app"],
      },
    },
  },
  async () => {
    const startTime = Date.now();
    toolLogger.info({ tool: "list_projects" }, "Tool called: list_projects");

    try {
      const projects = await client.listProjects();

      // Enrich with test case counts
      const enrichedProjects = await Promise.all(
        projects.map(async (project) => {
          try {
            const testCases = await client.listTestCases(project.id);
            return {
              ...project,
              test_case_count: testCases.length,
              active_count: testCases.filter((tc) => tc.status === "active").length,
            };
          } catch {
            return { ...project, test_case_count: 0, active_count: 0 };
          }
        })
      );

      const textSummary = enrichedProjects.length === 0
        ? "No projects found."
        : enrichedProjects
            .map((p) => `- ${p.name} (${p.test_case_count} tests) - ${p.base_url}`)
            .join("\n");

      toolLogger.info(
        { tool: "list_projects", success: true, projectCount: enrichedProjects.length, durationMs: Date.now() - startTime },
        "Tool completed: list_projects"
      );

      return {
        content: [{ type: "text" as const, text: `Projects:\n${textSummary}` }],
        structuredContent: { projects: enrichedProjects },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toolLogger.error(
        { tool: "list_projects", success: false, error: message, durationMs: Date.now() - startTime },
        "Tool failed: list_projects"
      );
      return {
        content: [{ type: "text" as const, text: `Error listing projects: ${message}` }],
        structuredContent: { error: message, projects: [] },
      };
    }
  }
);

// =============================================================================
// Tool: list_test_cases
// =============================================================================

server.registerTool(
  "list_test_cases",
  {
    description: "List all test cases in a Checkmate project. Shows test names, status, priority, and allows running tests directly.",
    inputSchema: {
      project_id: z.number().describe("The project ID to list test cases for"),
    },
    _meta: {
      ui: {
        resourceUri: TEST_CASES_UI_URI,
        visibility: ["model", "app"],
      },
    },
  },
  async ({ project_id }) => {
    const startTime = Date.now();
    toolLogger.info({ tool: "list_test_cases", projectId: project_id }, "Tool called: list_test_cases");

    try {
      const [project, testCases] = await Promise.all([
        client.getProject(project_id),
        client.listTestCases(project_id),
      ]);

      const textSummary = testCases.length === 0
        ? `No test cases found in project "${project.name}".`
        : testCases
            .map((tc) => `- [${tc.id}] ${tc.name} (${tc.status}, ${tc.priority})`)
            .join("\n");

      toolLogger.info(
        { tool: "list_test_cases", success: true, projectId: project_id, testCaseCount: testCases.length, durationMs: Date.now() - startTime },
        "Tool completed: list_test_cases"
      );

      return {
        content: [{
          type: "text" as const,
          text: `Test cases in "${project.name}":\n${textSummary}`,
        }],
        structuredContent: {
          project: {
            id: project.id,
            name: project.name,
          },
          testCases: testCases.map((tc) => ({
            id: tc.id,
            name: tc.name,
            description: tc.description,
            status: tc.status,
            priority: tc.priority,
            steps_count: tc.steps?.length || 0,
            updated_at: tc.updated_at,
          })),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toolLogger.error(
        { tool: "list_test_cases", success: false, projectId: project_id, error: message, durationMs: Date.now() - startTime },
        "Tool failed: list_test_cases"
      );
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        structuredContent: { error: message, testCases: [] },
      };
    }
  }
);

// =============================================================================
// Tool: run_test
// =============================================================================

server.registerTool(
  "run_test",
  {
    description:
      "Execute a Checkmate test case by ID. Shows real-time step progress with screenshots on failure.",
    inputSchema: {
      test_case_id: z.number().describe("The test case ID to execute"),
      browser: z
        .string()
        .optional()
        .describe("Browser to use: chromium, firefox, webkit, or chromium-headless (default)"),
    },
    _meta: {
      ui: {
        resourceUri: TEST_RUNNER_UI_URI,
        visibility: ["model", "app"],
      },
    },
  },
  async ({ test_case_id, browser }) => {
    const startTime = Date.now();
    toolLogger.info({ tool: "run_test", testCaseId: test_case_id, browser }, "Tool called: run_test");

    try {
      const testCase = await client.getTestCase(test_case_id);

      // Collect all SSE events (default: 2 retries with intelligent mode)
      const events: SSEEvent[] = [];
      for await (const event of client.executeTestCase(test_case_id, {
        browser,
        maxRetries: 2,
        retryMode: "intelligent",
      })) {
        toolLogger.debug({ tool: "run_test", testCaseId: test_case_id, eventType: event.type }, "SSE event received");
        events.push(event);
      }

      const completedEvent = events.find((e) => e.type === "run_completed");
      const status = completedEvent?.type === "run_completed" ? completedEvent.status : "unknown";
      const summary = completedEvent?.type === "run_completed" ? completedEvent.summary : "Test completed";

      toolLogger.info(
        { tool: "run_test", success: status === "passed", testCaseId: test_case_id, status, eventCount: events.length, durationMs: Date.now() - startTime },
        "Tool completed: run_test"
      );

      return {
        content: [{ type: "text" as const, text: `Test: ${testCase.name}\nStatus: ${status}\n${summary}` }],
        structuredContent: {
          testCase: {
            id: testCase.id,
            name: testCase.name,
            description: testCase.description,
          },
          events,
          status,
          summary,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toolLogger.error(
        { tool: "run_test", success: false, testCaseId: test_case_id, error: message, durationMs: Date.now() - startTime },
        "Tool failed: run_test"
      );
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        structuredContent: { error: message, events: [] },
      };
    }
  }
);

// =============================================================================
// Tool: run_natural_test
// =============================================================================

server.registerTool(
  "run_natural_test",
  {
    description:
      'Execute a test from natural language description without creating a test case. Example: "login as admin and check if dashboard loads"',
    inputSchema: {
      project_id: z.number().describe("The project ID to run the test in"),
      query: z.string().describe("Natural language description of the test to run"),
      fixture_ids: z
        .array(z.number())
        .optional()
        .describe("Optional fixture IDs to use (e.g., for login setup)"),
      browser: z
        .string()
        .optional()
        .describe("Browser to use: chromium, firefox, webkit, or chromium-headless (default)"),
    },
    _meta: {
      ui: {
        resourceUri: TEST_RUNNER_UI_URI,
        visibility: ["model", "app"],
      },
    },
  },
  async ({ project_id, query, fixture_ids, browser }) => {
    const startTime = Date.now();
    toolLogger.info({ tool: "run_natural_test", projectId: project_id, query, browser }, "Tool called: run_natural_test");

    try {
      // Build test steps from natural language
      toolLogger.debug({ tool: "run_natural_test", projectId: project_id }, "Generating test steps from query");
      const buildResult = await client.buildTest(project_id, query, fixture_ids);
      const steps: TestStep[] = buildResult.test_case.steps;
      // Use fixture_ids from build response (AI determines which fixtures are needed)
      const resolvedFixtureIds = buildResult.test_case.fixture_ids || fixture_ids || [];
      toolLogger.debug(
        { tool: "run_natural_test", stepCount: steps.length, fixtureIds: resolvedFixtureIds },
        "Test steps generated"
      );

      // Execute and collect all SSE events (with retry defaults)
      const events: SSEEvent[] = [];
      for await (const event of client.executeSteps(project_id, steps, { browser, fixtureIds: resolvedFixtureIds })) {
        toolLogger.debug({ tool: "run_natural_test", eventType: event.type }, "SSE event received");
        events.push(event);
      }

      const completedEvent = events.find((e) => e.type === "run_completed");
      const status = completedEvent?.type === "run_completed" ? completedEvent.status : "unknown";
      const summary = completedEvent?.type === "run_completed" ? completedEvent.summary : "Test completed";

      toolLogger.info(
        { tool: "run_natural_test", success: status === "passed", projectId: project_id, status, stepCount: steps.length, eventCount: events.length, durationMs: Date.now() - startTime },
        "Tool completed: run_natural_test"
      );

      return {
        content: [{ type: "text" as const, text: `Test: "${query}"\nStatus: ${status}\n${summary}` }],
        structuredContent: {
          query,
          generatedSteps: steps,
          testCase: {
            name: query,
            description: `Natural language test: ${query}`,
          },
          events,
          status,
          summary,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toolLogger.error(
        { tool: "run_natural_test", success: false, projectId: project_id, error: message, durationMs: Date.now() - startTime },
        "Tool failed: run_natural_test"
      );
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        structuredContent: { error: message, events: [] },
      };
    }
  }
);

// =============================================================================
// Express Server Setup
// =============================================================================

const expressApp = express();
expressApp.disable("x-powered-by");
expressApp.use(express.json());

// Health check endpoint
expressApp.get("/health", async (_req, res) => {
  const checkmateHealthy = await client.healthCheck();
  res.json({
    status: "ok",
    name: "checkmate-mcp",
    checkmate: checkmateHealthy ? "connected" : "unavailable",
    checkmateUrl: CHECKMATE_URL,
  });
});

// =============================================================================
// SSE Proxy Endpoints (to avoid CORS issues with MCP App iframe)
// =============================================================================

// Validation schemas for proxy endpoints
const browserSchema = z.enum(["chromium", "chromium-headless", "firefox", "firefox-headless", "webkit", "webkit-headless"]).optional();

const testCaseRunSchema = z.object({
  browser: browserSchema,
});

const executeStepsSchema = z.object({
  project_id: z.number().int().positive(),
  steps: z.array(z.string()).min(1),
  browser: browserSchema,
  fixture_ids: z.array(z.number().int().positive()).optional(),
});

// Proxy for test case execution SSE
expressApp.post("/proxy/test-cases/:testCaseId/runs/stream", async (req, res) => {
  const testCaseId = parseInt(req.params.testCaseId, 10);
  if (isNaN(testCaseId) || testCaseId <= 0) {
    res.status(400).json({ error: "Invalid testCaseId: must be a positive integer" });
    return;
  }

  const bodyResult = testCaseRunSchema.safeParse(req.body);
  if (!bodyResult.success) {
    res.status(400).json({ error: "Invalid request body", details: bodyResult.error.issues });
    return;
  }
  const { browser } = bodyResult.data;

  apiLogger.info({ endpoint: "proxy/test-cases/stream", testCaseId, browser }, "SSE proxy request");

  try {
    const response = await fetch(`${CHECKMATE_URL}/api/test-cases/${testCaseId}/runs/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
      },
      body: JSON.stringify({ browser: browser || "chromium-headless" }),
    });

    if (!response.ok) {
      res.status(response.status).json({ error: `Checkmate API error: ${response.statusText}` });
      return;
    }

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Pipe the response
    const reader = response.body?.getReader();
    if (!reader) {
      res.end();
      return;
    }

    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    };

    req.on("close", () => {
      reader.cancel();
    });

    await pump();
  } catch (error) {
    apiLogger.error({ endpoint: "proxy/test-cases/stream", testCaseId, error }, "SSE proxy error");
    res.status(500).json({ error: error instanceof Error ? error.message : "Proxy error" });
  }
});

// Proxy for execute steps SSE (natural language tests)
expressApp.post("/proxy/test-runs/execute/stream", async (req, res) => {
  const bodyResult = executeStepsSchema.safeParse(req.body);
  if (!bodyResult.success) {
    res.status(400).json({ error: "Invalid request body", details: bodyResult.error.issues });
    return;
  }
  const { project_id, steps, browser, fixture_ids } = bodyResult.data;

  apiLogger.info({ endpoint: "proxy/test-runs/stream", projectId: project_id, stepCount: steps.length }, "SSE proxy request");

  try {
    const response = await fetch(`${CHECKMATE_URL}/api/test-runs/execute/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
      },
      body: JSON.stringify({ project_id, steps, browser, fixture_ids }),
    });

    if (!response.ok) {
      res.status(response.status).json({ error: `Checkmate API error: ${response.statusText}` });
      return;
    }

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Pipe the response
    const reader = response.body?.getReader();
    if (!reader) {
      res.end();
      return;
    }

    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    };

    req.on("close", () => {
      reader.cancel();
    });

    await pump();
  } catch (error) {
    apiLogger.error({ endpoint: "proxy/test-runs/stream", projectId: project_id, error }, "SSE proxy error");
    res.status(500).json({ error: error instanceof Error ? error.message : "Proxy error" });
  }
});

// MCP endpoint
expressApp.post("/mcp", async (req, res) => {
  apiLogger.debug({ endpoint: "/mcp", method: req.body?.method }, "MCP request received");

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => transport.close());

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// Start server
expressApp.listen(PORT, () => {
  serverLogger.info(
    {
      port: PORT,
      mcpEndpoint: `http://localhost:${PORT}/mcp`,
      healthEndpoint: `http://localhost:${PORT}/health`,
      checkmateUrl: CHECKMATE_URL,
      tools: ["list_projects", "list_test_cases", "run_test", "run_natural_test"],
    },
    "Checkmate MCP Server started"
  );
});

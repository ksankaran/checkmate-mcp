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
import type { SSEEvent, TestStep } from "./src/types.js";

console.log("Starting Checkmate MCP Server...");

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
    console.log(`Loaded UI: ${filename}`);
    return html;
  } catch (e) {
    console.error(`Failed to load UI ${filename}:`, e);
    return `<!DOCTYPE html><html><body><h1>UI not found: ${filename}</h1></body></html>`;
  }
}

const PROJECTS_UI = loadUI("projects.html");
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
const TEST_RUNNER_UI_URI = "ui://checkmate-mcp/test-runner";

server.resource("projects-ui", PROJECTS_UI_URI, {
  description: "Projects listing UI",
  mimeType: "text/html;profile=mcp-app",
}, async (uri) => {
  console.log(`[Resource] Serving projects UI: ${uri.href}`);
  return {
    contents: [{
      uri: uri.href,
      mimeType: "text/html;profile=mcp-app",
      text: PROJECTS_UI,
      _meta: { ui: { csp: {}, prefersBorder: false } },
    }],
  };
});

server.resource("test-runner-ui", TEST_RUNNER_UI_URI, {
  description: "Test execution UI with real-time progress",
  mimeType: "text/html;profile=mcp-app",
}, async (uri) => {
  console.log(`[Resource] Serving test-runner UI: ${uri.href}`);
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
    console.log("[Tool] list_projects called");

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

      return {
        content: [{ type: "text" as const, text: `Projects:\n${textSummary}` }],
        structuredContent: { projects: enrichedProjects },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
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
    description: "List all test cases in a Checkmate project.",
    inputSchema: {
      project_id: z.number().describe("The project ID to list test cases for"),
    },
  },
  async ({ project_id }) => {
    console.log(`[Tool] list_test_cases called for project ${project_id}`);

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

      return {
        content: [{
          type: "text" as const,
          text: `Test cases in "${project.name}":\n${textSummary}`,
        }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
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
    console.log(`[Tool] run_test called for test case ${test_case_id}`);

    try {
      const testCase = await client.getTestCase(test_case_id);

      // Collect all SSE events (default: 2 retries with intelligent mode)
      const events: SSEEvent[] = [];
      for await (const event of client.executeTestCase(test_case_id, {
        browser,
        maxRetries: 2,
        retryMode: "intelligent",
      })) {
        console.log(`[SSE] ${event.type}`);
        events.push(event);
      }

      const completedEvent = events.find((e) => e.type === "run_completed");
      const status = completedEvent?.type === "run_completed" ? completedEvent.status : "unknown";
      const summary = completedEvent?.type === "run_completed" ? completedEvent.summary : "Test completed";

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
    console.log(`[Tool] run_natural_test called: "${query}" in project ${project_id}`);

    try {
      // Build test steps from natural language
      console.log("[Build] Generating test steps...");
      const buildResult = await client.buildTest(project_id, query, fixture_ids);
      const steps: TestStep[] = buildResult.test_case.steps;
      // Use fixture_ids from build response (AI determines which fixtures are needed)
      const resolvedFixtureIds = buildResult.test_case.fixture_ids || fixture_ids || [];
      console.log(`[Build] Generated ${steps.length} steps, fixtures: ${resolvedFixtureIds}`);

      // Execute and collect all SSE events (with retry defaults)
      const events: SSEEvent[] = [];
      for await (const event of client.executeSteps(project_id, steps, { browser, fixtureIds: resolvedFixtureIds })) {
        console.log(`[SSE] ${event.type}`);
        events.push(event);
      }

      const completedEvent = events.find((e) => e.type === "run_completed");
      const status = completedEvent?.type === "run_completed" ? completedEvent.status : "unknown";
      const summary = completedEvent?.type === "run_completed" ? completedEvent.summary : "Test completed";

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

// Proxy for test case execution SSE
expressApp.post("/proxy/test-cases/:testCaseId/runs/stream", async (req, res) => {
  const { testCaseId } = req.params;
  const { browser } = req.body;

  console.log(`[Proxy] SSE request for test case ${testCaseId}`);

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
    console.error("[Proxy] Error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Proxy error" });
  }
});

// Proxy for execute steps SSE (natural language tests)
expressApp.post("/proxy/test-runs/execute/stream", async (req, res) => {
  const { project_id, steps, browser, fixture_ids } = req.body;

  console.log(`[Proxy] SSE request for execute steps in project ${project_id}`);

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
    console.error("[Proxy] Error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Proxy error" });
  }
});

// MCP endpoint
expressApp.post("/mcp", async (req, res) => {
  console.log("[MCP] POST request received");

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
  console.log(`\nCheckmate MCP Server listening on http://localhost:${PORT}/mcp`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Checkmate API: ${CHECKMATE_URL}`);
  console.log(`\nTools available:`);
  console.log(`  - list_projects (with fancy UI)`);
  console.log(`  - list_test_cases`);
  console.log(`  - run_test (with real-time UI)`);
  console.log(`  - run_natural_test (with real-time UI)`);
});

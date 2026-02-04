/**
 * Checkmate API Client
 *
 * Handles communication with the Checkmate backend API.
 */

import type {
  Project,
  TestCase,
  TestCaseParsed,
  TestStep,
  BuildResponse,
  SSEEvent,
  Fixture,
  FixtureParsed,
} from "./types.js";

export class CheckmateClient {
  private baseUrl: string;

  constructor(baseUrl: string = "http://localhost:8000") {
    this.baseUrl = baseUrl.replace(/\/$/, ""); // Remove trailing slash
  }

  // ===========================================================================
  // Projects
  // ===========================================================================

  async listProjects(): Promise<Project[]> {
    const response = await fetch(`${this.baseUrl}/api/projects`);
    if (!response.ok) {
      throw new Error(`Failed to list projects: ${response.statusText}`);
    }
    return response.json();
  }

  async getProject(projectId: number): Promise<Project> {
    const response = await fetch(`${this.baseUrl}/api/projects/${projectId}`);
    if (!response.ok) {
      throw new Error(`Failed to get project ${projectId}: ${response.statusText}`);
    }
    return response.json();
  }

  // ===========================================================================
  // Test Cases
  // ===========================================================================

  async listTestCases(projectId: number): Promise<TestCaseParsed[]> {
    const response = await fetch(`${this.baseUrl}/api/test-cases/project/${projectId}`);
    if (!response.ok) {
      throw new Error(`Failed to list test cases: ${response.statusText}`);
    }
    const testCases: TestCase[] = await response.json();

    // Parse JSON fields
    return testCases.map((tc) => ({
      ...tc,
      steps: tc.steps ? JSON.parse(tc.steps) : [],
      tags: tc.tags ? JSON.parse(tc.tags) : [],
      fixture_ids: tc.fixture_ids ? JSON.parse(tc.fixture_ids) : [],
    }));
  }

  async getTestCase(testCaseId: number): Promise<TestCaseParsed> {
    const response = await fetch(`${this.baseUrl}/api/test-cases/${testCaseId}`);
    if (!response.ok) {
      throw new Error(`Failed to get test case ${testCaseId}: ${response.statusText}`);
    }
    const tc: TestCase = await response.json();

    return {
      ...tc,
      steps: tc.steps ? JSON.parse(tc.steps) : [],
      tags: tc.tags ? JSON.parse(tc.tags) : [],
      fixture_ids: tc.fixture_ids ? JSON.parse(tc.fixture_ids) : [],
    };
  }

  // ===========================================================================
  // Fixtures
  // ===========================================================================

  async listFixtures(projectId: number): Promise<FixtureParsed[]> {
    const response = await fetch(`${this.baseUrl}/api/projects/${projectId}/fixtures`);
    if (!response.ok) {
      throw new Error(`Failed to list fixtures: ${response.statusText}`);
    }
    const fixtures: Fixture[] = await response.json();

    return fixtures.map((f) => ({
      ...f,
      setup_steps: f.setup_steps ? JSON.parse(f.setup_steps) : [],
    }));
  }

  async getFixture(fixtureId: number): Promise<FixtureParsed> {
    const response = await fetch(`${this.baseUrl}/api/fixtures/${fixtureId}`);
    if (!response.ok) {
      throw new Error(`Failed to get fixture ${fixtureId}: ${response.statusText}`);
    }
    const f: Fixture = await response.json();

    return {
      ...f,
      setup_steps: f.setup_steps ? JSON.parse(f.setup_steps) : [],
    };
  }

  // ===========================================================================
  // Build Test from Natural Language
  // ===========================================================================

  async buildTest(
    projectId: number,
    naturalQuery: string,
    fixtureIds?: number[]
  ): Promise<BuildResponse> {
    const response = await fetch(`${this.baseUrl}/api/agent/projects/${projectId}/build`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: naturalQuery,
        fixture_ids: fixtureIds || [],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to build test: ${errorText}`);
    }

    return response.json();
  }

  // ===========================================================================
  // Execute Test Case (Streaming)
  // ===========================================================================

  async *executeTestCase(
    testCaseId: number,
    options?: { browser?: string; maxRetries?: number; retryMode?: string }
  ): AsyncGenerator<SSEEvent> {
    const body: Record<string, unknown> = {};
    if (options?.browser) body.browser = options.browser;
    if (options?.maxRetries !== undefined) {
      body.retry = {
        max_retries: options.maxRetries,
        retry_mode: options.retryMode || "simple",
      };
    }

    const response = await fetch(
      `${this.baseUrl}/api/test-cases/${testCaseId}/runs/stream`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to execute test case: ${errorText}`);
    }

    yield* this.parseSSEStream(response);
  }

  // ===========================================================================
  // Execute Steps Directly (Streaming) - for natural language tests
  // ===========================================================================

  async *executeSteps(
    projectId: number,
    steps: TestStep[],
    options?: { browser?: string; fixtureIds?: number[] }
  ): AsyncGenerator<SSEEvent> {
    const body: Record<string, unknown> = {
      project_id: projectId,
      steps,
    };
    if (options?.browser) body.browser = options.browser;
    if (options?.fixtureIds) body.fixture_ids = options.fixtureIds;

    const response = await fetch(`${this.baseUrl}/api/test-runs/execute/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to execute steps: ${errorText}`);
    }

    yield* this.parseSSEStream(response);
  }

  // ===========================================================================
  // SSE Stream Parser
  // ===========================================================================

  private async *parseSSEStream(response: Response): AsyncGenerator<SSEEvent> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data) {
              try {
                const event: SSEEvent = JSON.parse(data);
                yield event;
              } catch (e) {
                console.error("Failed to parse SSE event:", data, e);
              }
            }
          }
        }
      }

      // Process any remaining data in buffer
      if (buffer.startsWith("data: ")) {
        const data = buffer.slice(6).trim();
        if (data) {
          try {
            const event: SSEEvent = JSON.parse(data);
            yield event;
          } catch (e) {
            console.error("Failed to parse final SSE event:", data, e);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ===========================================================================
  // Health Check
  // ===========================================================================

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }
}

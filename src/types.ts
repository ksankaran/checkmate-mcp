/**
 * Checkmate MCP Server Types
 */

// =============================================================================
// Project Types
// =============================================================================

export interface Project {
  id: number;
  name: string;
  description: string | null;
  base_url: string;
  config: string | null;
  base_prompt: string | null;
  page_load_state: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectWithStats extends Project {
  test_case_count?: number;
  last_run_status?: string;
}

// =============================================================================
// Test Case Types
// =============================================================================

export type Priority = "low" | "medium" | "high" | "critical";
export type TestCaseStatus = "active" | "draft" | "archived";

export interface TestCase {
  id: number;
  project_id: number;
  name: string;
  description: string | null;
  natural_query: string;
  steps: string; // JSON array
  expected_result: string | null;
  tags: string | null; // JSON array
  fixture_ids: string | null; // JSON array
  priority: Priority;
  status: TestCaseStatus;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface TestCaseParsed extends Omit<TestCase, "steps" | "tags" | "fixture_ids"> {
  steps: TestStep[];
  tags: string[];
  fixture_ids: number[];
}

// =============================================================================
// Test Step Types
// =============================================================================

export interface TestStep {
  action: string;
  target: string | null;
  value: string | null;
  description?: string;
}

// =============================================================================
// Test Run Types
// =============================================================================

export type RunStatus = "pending" | "running" | "passed" | "failed" | "cancelled";
export type RunTrigger = "manual" | "scheduled" | "natural_language" | "ci_cd";
export type StepStatus = "pending" | "running" | "passed" | "failed" | "skipped";

export interface TestRun {
  id: number;
  project_id: number;
  test_case_id: number | null;
  trigger: RunTrigger;
  status: RunStatus;
  thread_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  summary: string | null;
  error_count: number;
  pass_count: number;
  created_at: string;
  retry_attempt: number;
  max_retries: number;
  original_run_id: number | null;
  retry_mode: string | null;
  retry_reason: string | null;
  steps?: TestRunStep[];
}

export interface TestRunStep {
  id: number;
  test_run_id: number;
  test_case_id: number | null;
  step_number: number;
  action: string;
  target: string | null;
  value: string | null;
  status: StepStatus;
  result: string | null;
  screenshot: string | null; // base64
  duration: number | null;
  error: string | null;
  logs: string | null;
  fixture_name: string | null;
  created_at: string;
}

// =============================================================================
// SSE Event Types (from /runs/stream and /execute/stream)
// =============================================================================

export interface RunStartedEvent {
  type: "run_started";
  run_id: number;
  test_case_id: number | null;
  total_steps: number;
  retry_attempt: number;
  max_retries: number;
  original_run_id: number | null;
}

export interface StepStartedEvent {
  type: "step_started";
  step_number: number;
  action: string;
  description?: string;
  fixture_name: string | null;
  target?: string | null;
  value?: string | null;
}

export interface StepCompletedEvent {
  type: "step_completed";
  step_number: number;
  action: string;
  status: StepStatus;
  duration: number;
  error: string | null;
  screenshot: string | null; // base64
  target: string | null;
  value: string | null;
  fixture_name: string | null;
}

export interface RunCompletedEvent {
  type: "run_completed";
  run_id: number;
  status: RunStatus;
  pass_count: number;
  error_count: number;
  summary: string;
  retry_attempt: number;
  max_retries: number;
}

export interface ErrorEvent {
  type: "error";
  message: string;
}

export interface WarningEvent {
  type: "warning";
  message: string;
}

export interface RetryScheduledEvent {
  type: "retry_scheduled";
  original_run_id: number;
  retry_attempt: number;
  reason: string;
}

export type SSEEvent =
  | RunStartedEvent
  | StepStartedEvent
  | StepCompletedEvent
  | RunCompletedEvent
  | ErrorEvent
  | WarningEvent
  | RetryScheduledEvent;

// =============================================================================
// Build API Types (for natural language test)
// =============================================================================

export interface BuildRequest {
  natural_query: string;
  fixture_ids?: number[];
}

export interface BuildResponse {
  test_case: {
    name: string;
    natural_query: string;
    priority: string;
    tags: string[];
    steps: TestStep[];
    fixture_ids: number[];
  };
  message: string | null;
  needs_clarification: boolean;
}

// =============================================================================
// Execute API Types (for direct step execution)
// =============================================================================

export interface ExecuteRequest {
  project_id: number;
  steps: TestStep[];
  browser?: string;
  fixture_ids?: number[];
}

// =============================================================================
// Fixture Types
// =============================================================================

export interface Fixture {
  id: number;
  project_id: number;
  name: string;
  description: string | null;
  setup_steps: string; // JSON array
  scope: string;
  cache_ttl_seconds: number;
  created_at: string;
  updated_at: string;
}

export interface FixtureParsed extends Omit<Fixture, "setup_steps"> {
  setup_steps: TestStep[];
}

import { App } from "@modelcontextprotocol/ext-apps";

interface TestCase {
  id: number;
  name: string;
  description?: string;
}

interface SSEEvent {
  type: string;
  run_id?: number;
  total_steps?: number;
  step_number?: number;
  action?: string;
  target?: string | null;
  value?: string | null;
  status?: string;
  duration?: number;
  error?: string;
  screenshot?: string;
  retried?: boolean;
}

interface TestRunnerData {
  testCase?: TestCase;
  events?: SSEEvent[];
  error?: string;
}

interface StepState {
  number: number;
  action: string;
  target: string | null;
  value: string | null;
  status: string;
  duration: number;
  error?: string;
  screenshot?: string;
  retried?: boolean;
}

// Create app instance
const app = new App(
  { name: "checkmate-test-runner", version: "1.0.0" },
  {},
  { autoResize: true }
);

// Track step states
const steps: Map<number, StepState> = new Map();

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function renderStep(step: StepState): string {
  const statusClass = step.status || "running";
  const targetDisplay = step.target || step.value || "";
  const badges: string[] = [];

  if (step.retried) {
    badges.push('<span class="badge badge-retried">retried</span>');
  }

  let html = `
    <div class="step ${statusClass}">
      <div class="step-header">
        <div class="step-number">${step.number}</div>
        <div class="step-content">
          <div class="step-action">
            ${escapeHtml(step.action)}
            ${badges.join("")}
          </div>
          ${targetDisplay ? `<div class="step-target">${escapeHtml(targetDisplay)}</div>` : ""}
        </div>
        ${step.duration > 0 ? `<div class="step-duration">${formatDuration(step.duration)}</div>` : ""}
      </div>
  `;

  if (step.error) {
    html += `<div class="step-error">${escapeHtml(step.error)}</div>`;
  }

  if (step.screenshot) {
    const src = step.screenshot.startsWith("data:") ? step.screenshot : `data:image/png;base64,${step.screenshot}`;
    html += `<div class="step-screenshot"><img src="${src}" alt="Screenshot" /></div>`;
  }

  html += "</div>";
  return html;
}

function updateStepsList(): void {
  const stepsList = document.getElementById("steps");
  if (!stepsList) return;

  const sortedSteps = Array.from(steps.values()).sort((a, b) => a.number - b.number);
  stepsList.innerHTML = sortedSteps.map(renderStep).join("");
}

function processEvent(event: SSEEvent): void {
  switch (event.type) {
    case "run_started":
      // Initialize UI
      break;

    case "step_started":
      if (event.step_number) {
        steps.set(event.step_number, {
          number: event.step_number,
          action: event.action || "unknown",
          target: event.target || null,
          value: event.value || null,
          status: "running",
          duration: 0,
        });
        updateStepsList();
      }
      break;

    case "step_completed":
      if (event.step_number) {
        const step = steps.get(event.step_number);
        if (step) {
          step.status = event.status || "passed";
          step.duration = event.duration || 0;
          step.error = event.error;
          step.screenshot = event.screenshot;
          step.retried = event.retried;
          updateStepsList();
        }
      }
      break;

    case "run_completed":
      showSummary();
      break;
  }
}

function showSummary(): void {
  const summary = document.getElementById("summary");
  const summaryIcon = document.getElementById("summaryIcon");
  const summaryTitle = document.getElementById("summaryTitle");
  const passedCount = document.getElementById("passedCount");
  const failedCount = document.getElementById("failedCount");
  const totalDuration = document.getElementById("totalDuration");

  if (!summary) return;

  let passed = 0;
  let failed = 0;
  let duration = 0;

  steps.forEach((step) => {
    if (step.status === "passed") passed++;
    else if (step.status === "failed" || step.status === "skipped") failed++;
    duration += step.duration;
  });

  const testFailed = failed > 0;

  summary.className = `summary ${testFailed ? "failed" : "passed"}`;
  summary.style.display = "block";

  if (summaryIcon) summaryIcon.textContent = testFailed ? "❌" : "✅";
  if (summaryTitle) summaryTitle.textContent = testFailed ? "Test Failed" : "Test Passed";
  if (passedCount) passedCount.textContent = String(passed);
  if (failedCount) failedCount.textContent = String(failed);
  if (totalDuration) totalDuration.textContent = formatDuration(duration);
}

function processToolResult(data: TestRunnerData): void {
  const loading = document.getElementById("loading");
  const stepsList = document.getElementById("steps");
  const errorDiv = document.getElementById("error");
  const testName = document.getElementById("testName");
  const testDescription = document.getElementById("testDescription");

  if (loading) loading.style.display = "none";

  if (data.error) {
    if (errorDiv) {
      errorDiv.style.display = "block";
      errorDiv.textContent = `Error: ${data.error}`;
    }
    return;
  }

  // Set test info
  if (data.testCase) {
    if (testName) testName.textContent = data.testCase.name;
    if (testDescription) testDescription.textContent = data.testCase.description || "";
  }

  // Show steps container
  if (stepsList) stepsList.style.display = "flex";

  // Clear previous state
  steps.clear();

  // Process all events
  const events = data.events || [];
  events.forEach(processEvent);
}

// Handle tool result notification
app.ontoolresult = (params) => {
  console.log("Tool result received:", params);
  if (params.structuredContent) {
    processToolResult(params.structuredContent as TestRunnerData);
  }
};

// Handle host context changes
app.onhostcontextchanged = (params) => {
  console.log("Host context changed:", params);
};

// Handle errors
app.onerror = (error) => {
  console.error("App error:", error);
};

// Connect to host
app.connect().then(() => {
  console.log("Connected to host");
  const ctx = app.getHostContext();
  console.log("Host context:", ctx);
}).catch((error) => {
  console.error("Failed to connect:", error);
  // Demo mode
  processToolResult({
    testCase: { id: 1, name: "Demo Test", description: "Example test execution" },
    events: [
      { type: "run_started", run_id: 1, total_steps: 3 },
      { type: "step_started", step_number: 1, action: "navigate", target: null, value: "https://example.com" },
      { type: "step_completed", step_number: 1, action: "navigate", status: "passed", duration: 250 },
      { type: "step_started", step_number: 2, action: "click", target: "#login-btn" },
      { type: "step_completed", step_number: 2, action: "click", status: "passed", duration: 150, retried: true },
      { type: "step_started", step_number: 3, action: "verify", target: ".dashboard" },
      { type: "step_completed", step_number: 3, action: "verify", status: "passed", duration: 100 },
      { type: "run_completed", status: "passed" },
    ],
  });
});

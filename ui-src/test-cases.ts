import { App } from "@modelcontextprotocol/ext-apps";

interface TestCase {
  id: number;
  name: string;
  description: string;
  status: string;
  priority: string;
  steps_count: number;
  updated_at: string;
}

interface Project {
  id: number;
  name: string;
}

interface TestCasesData {
  project?: Project;
  testCases?: TestCase[];
  error?: string;
}

// Create app instance
const app = new App(
  { name: "checkmate-test-cases", version: "1.0.0" },
  {},
  { autoResize: true }
);

// Toast notification
function showToast(message: string): void {
  const toast = document.getElementById("toast");
  if (toast) {
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 3000);
  }
}

// Handle running a test
async function runTest(testCaseId: number, testName: string): Promise<void> {
  showToast(`Requesting to run: ${testName}`);
  try {
    await app.sendMessage({
      role: "user",
      content: [{ type: "text", text: `Run test case ${testCaseId}` }],
    });
  } catch (error) {
    console.error("Failed to send message:", error);
    showToast("Failed to request test run");
  }
}

// Render test cases grid
function renderTestCases(data: TestCasesData): void {
  const loading = document.getElementById("loading");
  const testCasesGrid = document.getElementById("testCases");
  const errorDiv = document.getElementById("error");
  const countSpan = document.getElementById("count");
  const projectNameDiv = document.getElementById("projectName");

  if (loading) loading.style.display = "none";

  if (data.error) {
    if (errorDiv) {
      errorDiv.style.display = "block";
      errorDiv.textContent = `Error: ${data.error}`;
    }
    return;
  }

  const testCases = data.testCases || [];
  const project = data.project;

  if (projectNameDiv && project) {
    projectNameDiv.textContent = `Project: ${project.name}`;
  }

  if (countSpan) {
    countSpan.textContent = `${testCases.length} test${testCases.length !== 1 ? "s" : ""}`;
  }

  if (testCases.length === 0) {
    if (testCasesGrid) {
      testCasesGrid.style.display = "block";
      testCasesGrid.innerHTML = '<div class="empty-state">No test cases found in this project.</div>';
    }
    return;
  }

  if (testCasesGrid) {
    testCasesGrid.style.display = "grid";
    testCasesGrid.innerHTML = testCases
      .map((tc) => {
        const safeName = tc.name.replace(/'/g, "\\'");
        const updated = new Date(tc.updated_at).toLocaleDateString();
        return `
          <div class="test-case-card">
            <div class="test-case-header">
              <div class="test-case-name">${escapeHtml(tc.name)}</div>
              <div class="test-case-badges">
                <span class="badge badge-status ${tc.status}">${tc.status}</span>
                <span class="badge badge-priority ${tc.priority}">${tc.priority}</span>
              </div>
            </div>
            <div class="test-case-description">${escapeHtml(tc.description || "No description")}</div>
            <div class="test-case-meta">
              <div class="test-case-steps">
                <span>&#128221;</span>
                <span>${tc.steps_count} steps</span>
                <span style="margin-left: 8px;">&#128197;</span>
                <span>${updated}</span>
              </div>
              <button class="run-button" data-test-id="${tc.id}" data-test-name="${safeName}">
                <span>&#9654;</span> Run Test
              </button>
            </div>
          </div>
        `;
      })
      .join("");

    // Add click handlers to run buttons
    testCasesGrid.querySelectorAll(".run-button").forEach((button) => {
      button.addEventListener("click", (e) => {
        e.stopPropagation();
        const testId = parseInt(button.getAttribute("data-test-id") || "0", 10);
        const testName = button.getAttribute("data-test-name") || "";
        runTest(testId, testName);
      });
    });
  }
}

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Handle tool result notification
app.ontoolresult = (params) => {
  console.log("Tool result received:", params);
  if (params.structuredContent) {
    renderTestCases(params.structuredContent as TestCasesData);
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
  renderTestCases({
    project: { id: 1, name: "Demo Project" },
    testCases: [
      {
        id: 1,
        name: "Login Flow Test",
        description: "Verify user can log in with valid credentials",
        status: "active",
        priority: "high",
        steps_count: 5,
        updated_at: new Date().toISOString(),
      },
      {
        id: 2,
        name: "Dashboard Load Test",
        description: "Check dashboard loads correctly after login",
        status: "active",
        priority: "medium",
        steps_count: 3,
        updated_at: new Date().toISOString(),
      },
    ],
  });
});

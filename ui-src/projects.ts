import { App } from "@modelcontextprotocol/ext-apps";

interface Project {
  id: number;
  name: string;
  base_url: string;
  test_case_count: number;
  active_count: number;
  updated_at: string;
}

interface ProjectsData {
  projects?: Project[];
  error?: string;
}

// Create app instance
const app = new App(
  { name: "checkmate-projects", version: "1.0.0" },
  {}, // capabilities
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

// Handle clicking on a project card
async function viewProject(projectId: number, projectName: string): Promise<void> {
  showToast(`Viewing test cases for: ${projectName}`);
  try {
    await app.sendMessage({
      role: "user",
      content: [{ type: "text", text: `List test cases in project ${projectId}` }],
    });
  } catch (error) {
    console.error("Failed to send message:", error);
    showToast("Failed to request test cases");
  }
}

// Render projects grid
function renderProjects(data: ProjectsData): void {
  const loading = document.getElementById("loading");
  const projectsGrid = document.getElementById("projects");
  const errorDiv = document.getElementById("error");
  const countSpan = document.getElementById("count");

  if (loading) loading.style.display = "none";

  if (data.error) {
    if (errorDiv) {
      errorDiv.style.display = "block";
      errorDiv.textContent = `Error: ${data.error}`;
    }
    return;
  }

  const projects = data.projects || [];

  if (countSpan) {
    countSpan.textContent = `${projects.length} project${projects.length !== 1 ? "s" : ""}`;
  }

  if (projects.length === 0) {
    if (projectsGrid) {
      projectsGrid.style.display = "block";
      projectsGrid.innerHTML = '<div class="empty-state">No projects found. Create a project in Checkmate to get started.</div>';
    }
    return;
  }

  if (projectsGrid) {
    projectsGrid.style.display = "grid";
    projectsGrid.innerHTML = projects
      .map((project) => {
        const safeName = project.name.replace(/'/g, "\\'");
        const updated = new Date(project.updated_at).toLocaleDateString();
        return `
          <div class="project-card" data-project-id="${project.id}" data-project-name="${safeName}">
            <div class="project-name">${escapeHtml(project.name)}</div>
            <div class="project-url">
              <a href="${escapeHtml(project.base_url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${escapeHtml(project.base_url)}</a>
            </div>
            <div class="project-stats">
              <div class="stat">
                <span class="stat-icon">&#128221;</span>
                <span>${project.test_case_count} tests</span>
              </div>
              <div class="stat">
                <span class="stat-icon">&#9989;</span>
                <span>${project.active_count} active</span>
              </div>
              <div class="stat">
                <span class="stat-icon">&#128197;</span>
                <span>${updated}</span>
              </div>
            </div>
            <div class="click-hint">Click to view test cases</div>
          </div>
        `;
      })
      .join("");

    // Add click handlers
    projectsGrid.querySelectorAll(".project-card").forEach((card) => {
      card.addEventListener("click", () => {
        const projectId = parseInt(card.getAttribute("data-project-id") || "0", 10);
        const projectName = card.getAttribute("data-project-name") || "";
        viewProject(projectId, projectName);
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
    renderProjects(params.structuredContent as ProjectsData);
  }
};

// Handle host context changes (theme, etc.)
app.onhostcontextchanged = (params) => {
  console.log("Host context changed:", params);
  // Could apply theme changes here
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
  // Demo mode - show example data
  renderProjects({
    projects: [
      {
        id: 1,
        name: "Demo Project",
        base_url: "https://example.com",
        test_case_count: 5,
        active_count: 3,
        updated_at: new Date().toISOString(),
      },
    ],
  });
});

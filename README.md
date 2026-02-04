# Checkmate MCP Server

MCP (Model Context Protocol) server that exposes [Checkmate](https://github.com/ksankaran/checkmate) AI-powered test execution capabilities with rich UI support for VS Code.

## Features

- **list_projects** - List all Checkmate projects with test counts (card grid UI)
- **list_test_cases** - List test cases in a project
- **run_test** - Execute a test case by ID with real-time step progress and screenshots
- **run_natural_test** - Execute tests from natural language descriptions

## Prerequisites

- Node.js 22+
- [Checkmate](https://github.com/ksankaran/checkmate) backend running on port 8000
- [Playwright HTTP Executor](https://github.com/ksankaran/playwright-http) running on port 8932
- VS Code Insiders (required for MCP Apps UI support)

## Installation

```bash
# Clone the repository
git clone https://github.com/ksankaran/checkmate-mcp.git
cd checkmate-mcp

# Install dependencies
npm install

# Copy environment config
cp .env.example .env

# Build (optional, for production)
npm run build
```

## Configuration

Edit `.env` file:

```env
# Port to run the MCP server on
PORT=3003

# Checkmate API URL (use 127.0.0.1, not localhost)
CHECKMATE_URL=http://127.0.0.1:8000
```

## Usage

### Local Development

```bash
# Start required services first:
# Terminal 1: Checkmate backend
cd /path/to/checkmate && uv run uvicorn api.main:app --port 8000

# Terminal 2: Playwright executor
cd /path/to/playwright-http && uv run uvicorn executor.main:app --port 8932

# Terminal 3: This MCP server
npm run dev
```

### Docker

```bash
# Build
docker build -t checkmate-mcp .

# Run
docker run -p 3003:3003 \
  -e PORT=3003 \
  -e CHECKMATE_URL=http://host.docker.internal:8000 \
  checkmate-mcp
```

## VS Code Setup

1. Open VS Code Insiders
2. Add to your VS Code settings or `.vscode/mcp.json`:

```json
{
  "servers": {
    "checkmate": {
      "type": "http",
      "url": "http://127.0.0.1:3003/mcp"
    }
  }
}
```

3. Reload VS Code window

## Example Prompts

```
"List my Checkmate projects"

"List test cases in project 2"

"Run test case 5"

"Run test case 3 with firefox browser"

"In project 1, navigate to the homepage and verify the title contains 'Welcome'"

"Test the login flow with admin credentials in project 2"
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `POST /mcp` | MCP protocol endpoint |

## Project Structure

```
checkmate-mcp/
├── server.ts              # MCP HTTP server
├── src/
│   ├── checkmate-client.ts  # Checkmate API client
│   └── types.ts             # TypeScript interfaces
├── ui/
│   ├── projects.html        # Projects card grid UI
│   └── test-runner.html     # Test execution UI
├── Dockerfile
├── package.json
└── tsconfig.json
```

## License

MIT

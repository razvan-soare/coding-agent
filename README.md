# Coding Agent

An autonomous coding agent orchestrator that uses Claude Code to plan, implement, and review code changes for your projects.

## Overview

Coding Agent automates software development by orchestrating three AI agents:

1. **Planner Agent** - Analyzes your project and generates detailed tasks
2. **Developer Agent** - Implements tasks using Claude Code's full capabilities
3. **Reviewer Agent** - Reviews changes for bugs, security issues, and code quality

The agents work in a loop: if the reviewer finds issues, the developer fixes them (up to 3 retries). Once approved, changes are committed and pushed to git.

## Installation

```bash
# Clone or navigate to the project
cd /path/to/codingAgent

# Install dependencies
npm install

# Build the project
npm run build

# (Optional) Link globally
npm link
```

## Quick Start

```bash
# 1. Initialize a new project with the interactive wizard
npm run dev -- init

# 2. Follow the prompts to define your project
#    - Project name and description
#    - Tech stack
#    - Features
#    - Milestones

# 3. Run the agent
npm run dev -- run <project-id>
```

## CLI Commands

### `init [name]`

Initialize a new project with an interactive wizard.

```bash
# Interactive wizard
npm run dev -- init

# With name pre-filled
npm run dev -- init my-portfolio

# Quick mode (skip wizard, use defaults)
npm run dev -- init my-project --quick

# Custom path
npm run dev -- init my-project --path /custom/path
```

**Options:**
| Option | Description |
|--------|-------------|
| `-p, --path <path>` | Custom project path (default: `./projects/<name>`) |
| `-q, --quick` | Skip wizard and create with minimal defaults |

**What it does:**
- Creates project directory
- Initializes git repository
- Runs interactive wizard to gather project details
- Generates `project_overview.md` with your specifications
- Creates milestones in the database
- Outputs the project ID for running the agent

---

### `run <project-id>`

Execute one orchestrator session (plan → develop → review → commit).

```bash
npm run dev -- run abc123-def456-...
```

**What it does:**
1. Checks for pending tasks or runs the Planner to generate one
2. Runs the Developer agent to implement the task
3. Runs the Reviewer agent to check the changes
4. If issues found: loops back to Developer (up to 3 times)
5. If approved: commits and pushes to git
6. Logs everything to the database

**Exit codes:**
- `0` - Success
- `1` - Failure (task failed or error occurred)

---

### `list`

List all registered projects.

```bash
npm run dev -- list
```

**Output:**
```
Projects:

  abc123-def456-789...
    Name: my-portfolio
    Path: /home/user/codingAgent/projects/my-portfolio

  def456-ghi789-012...
    Name: api-server
    Path: /home/user/codingAgent/projects/api-server
```

---

### `status <project-id>`

Show project status including task counts and recent runs.

```bash
npm run dev -- status abc123-def456-...
```

**Output:**
```
Project: my-portfolio
Path: /home/user/codingAgent/projects/my-portfolio

Tasks (5 total):
  completed: 3
  pending: 1
  failed: 1

Recent runs:
  a1b2c3d4 | completed | 2024-01-15T10:30:00
  e5f6g7h8 | failed    | 2024-01-15T09:15:00
```

---

### `tasks <project-id>`

List all tasks for a project with their status.

```bash
npm run dev -- tasks abc123-def456-...
```

**Output:**
```
Tasks for my-portfolio:

✓ [completed] Set up Next.js project structure
  ID: task-id-1

✓ [completed] Create hero section component
  ID: task-id-2

→ [in_progress] Implement projects gallery
  ID: task-id-3
  Retries: 1

○ [pending] Add contact form
  ID: task-id-4
```

**Status icons:**
| Icon | Status |
|------|--------|
| ✓ | completed |
| ✗ | failed |
| → | in_progress |
| ? | review |
| ○ | pending |

---

### `logs <run-id>`

View detailed logs for a specific run.

```bash
npm run dev -- logs a1b2c3d4-...
```

**Output:**
```
Logs for run a1b2c3d4-...:

[2024-01-15T10:30:00] ORCHESTRATOR - started
  Prompt: Starting run for project my-portfolio...

[2024-01-15T10:30:05] PLANNER - started
  Prompt: You are a technical project planner...

[2024-01-15T10:31:00] PLANNER - response_received
  Response: {"title": "Create hero section"...

[2024-01-15T10:31:05] DEVELOPER - started
  Prompt: You are implementing a feature...
```

---

## Configuration

Create a `.env` file (copy from `.env.example`):

```bash
cp .env.example .env
```

**Environment Variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_PATH` | `./data/coding-agent.db` | SQLite database location |
| `INACTIVITY_TIMEOUT_MS` | `120000` (2 min) | Kill agent if no output for this duration |
| `CLAUDE_CODE_PATH` | `claude` | Path to Claude Code CLI |

---

## Project Structure

```
codingAgent/
├── src/
│   ├── index.ts              # CLI entry point
│   ├── orchestrator.ts       # Main agent loop
│   ├── init-wizard.ts        # Interactive project setup
│   ├── agents/
│   │   ├── base-agent.ts     # Common agent logic
│   │   ├── planner.ts        # Task generation
│   │   ├── developer.ts      # Code implementation
│   │   └── reviewer.ts       # Code review
│   ├── db/                   # SQLite database layer
│   ├── git/                  # Git operations
│   ├── runner/
│   │   └── pty-runner.ts     # PTY wrapper with auto-responder
│   └── utils/
├── data/                     # SQLite database
├── projects/                 # Managed projects live here
├── package.json
└── tsconfig.json
```

---

## How It Works

### Agent Flow

```
┌─────────────────────────────────────────────────────────────┐
│                      ORCHESTRATOR                           │
│                                                             │
│  ┌─────────┐    ┌───────────┐    ┌──────────┐              │
│  │ Planner │───▶│ Developer │───▶│ Reviewer │──┐           │
│  │         │    │           │    │          │  │           │
│  └─────────┘    └───────────┘    └──────────┘  │           │
│       ▲                               │        │ 3 retries │
│       │         ┌─────────────────────┘        │           │
│       │         ▼                              │           │
│       │    [Issues?]──YES──────────────────────┘           │
│       │         │                                          │
│       │         NO                                         │
│       │         ▼                                          │
│       │    ┌──────────┐                                    │
│       │    │ Git Push │                                    │
│       │    └──────────┘                                    │
│       │                                                    │
│       └────────[Next run]                                  │
└─────────────────────────────────────────────────────────────┘
```

### Auto-Responder

The PTY runner detects when Claude Code asks questions and automatically responds:
- `(y/n)` → sends `y`
- `Press enter` → sends newline
- Other questions → sends `y`

This prevents the agent from getting stuck waiting for input.

### Inactivity Timeout

If an agent produces no output for 2 minutes (configurable), it's considered stuck and killed. This is an **inactivity** timeout, not a total runtime limit—agents can run for 30+ minutes as long as they're producing output.

---

## Database Schema

The SQLite database stores:

- **projects** - Registered projects with paths and milestones
- **milestones** - Project milestones for phased development
- **tasks** - Generated tasks with status and retry counts
- **runs** - Each orchestrator execution
- **logs** - Detailed logs with prompts and responses

All logs include a `run_id` so you can trace exactly what happened in each session.

---

## Example Workflow

```bash
# 1. Create a new portfolio project
npm run dev -- init my-portfolio

# Answer wizard questions:
#   - Description: Personal portfolio to showcase my projects
#   - Type: Web Application
#   - Stack: Next.js
#   - Features: Hero section, Projects gallery, Contact form, Blog
#   - Milestones: Auto-generate

# 2. Check the generated project overview
cat projects/my-portfolio/project_overview.md

# 3. Run the first session
npm run dev -- run <project-id>

# 4. Check status
npm run dev -- status <project-id>

# 5. View what tasks were created
npm run dev -- tasks <project-id>

# 6. Run another session to continue development
npm run dev -- run <project-id>

# 7. If something fails, check the logs
npm run dev -- logs <run-id>
```

---

## Troubleshooting

### Agent gets stuck

The auto-responder should handle most prompts, but if an agent hangs:
1. Check logs: `npm run dev -- logs <run-id>`
2. Increase timeout in `.env`: `INACTIVITY_TIMEOUT_MS=300000`
3. Ensure Claude Code is installed: `claude --version`

### Task keeps failing

After 3 retries, a task is marked as failed. To retry:
1. Check what went wrong: `npm run dev -- logs <run-id>`
2. Manually fix the issue in the project
3. Update the task status in the database or create a new task

### Claude Code not found

Ensure Claude Code is installed and in your PATH:
```bash
# Check if installed
claude --version

# Or specify custom path in .env
CLAUDE_CODE_PATH=/path/to/claude
```

---

## Future Enhancements

- [ ] Cron job setup for automated runs
- [ ] Support for OpenCode and Codex
- [ ] Web UI for monitoring
- [ ] Model routing based on task complexity
- [ ] Parallel task execution

---

## License

MIT

#!/usr/bin/env node

import { Command } from 'commander';
import { resolve, join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import {
  initializeSchema,
  createProject,
  createMilestone,
  getAllProjects,
  getProject,
  getProjectByPath,
  getTasksByProject,
  getRunsByProject,
  getLogsByRun,
  updateProject,
} from './db/index.js';
import { runOrchestrator } from './orchestrator.js';
import { CONFIG } from './utils/config.js';
import { isGitRepo, initGitRepo } from './git/operations.js';
import { runInitWizard, generateProjectOverview } from './init-wizard.js';

const program = new Command();

program
  .name('coding-agent')
  .description('Autonomous coding agent orchestrator using Claude Code')
  .version('1.0.0');

// Initialize database on startup
initializeSchema();

program
  .command('init [name]')
  .description('Initialize a new project with interactive wizard')
  .option('-p, --path <path>', 'Project path (defaults to projects/<name>)')
  .option('-q, --quick', 'Skip wizard and create with defaults')
  .action(async (name: string | undefined, options: { path?: string; quick?: boolean }) => {
    let projectConfig;
    let projectName: string;

    if (options.quick && name) {
      // Quick mode - skip wizard
      projectName = name;
      projectConfig = {
        name,
        description: 'A new project',
        projectType: 'other',
        techStack: ['custom'],
        features: ['Initial setup'],
        milestones: [{
          title: 'MVP',
          description: 'Minimum viable product',
          features: ['Initial setup'],
        }],
      };
    } else {
      // Interactive wizard
      const wizardResult = await runInitWizard(name);
      if (!wizardResult) {
        console.log('Setup cancelled.');
        process.exit(0);
      }
      projectConfig = wizardResult;
      projectName = projectConfig.name;
    }

    const projectPath = options.path
      ? resolve(options.path)
      : resolve(CONFIG.projectsDir, projectName);

    // Check if project already exists
    const existing = getProjectByPath(projectPath);
    if (existing) {
      console.error(`Project already exists at ${projectPath}`);
      process.exit(1);
    }

    // Create project directory
    mkdirSync(projectPath, { recursive: true });

    // Initialize git if needed
    if (!isGitRepo(projectPath)) {
      initGitRepo(projectPath);
      console.log('✓ Initialized git repository');
    }

    // Generate and write project overview
    const overviewPath = join(projectPath, 'project_overview.md');
    const overviewContent = generateProjectOverview(projectConfig);
    writeFileSync(overviewPath, overviewContent);
    console.log('✓ Created project_overview.md');

    // Create project in database
    const project = createProject({
      name: projectName,
      path: projectPath,
      overview_path: overviewPath,
    });

    // Create milestones from config
    let firstMilestone: ReturnType<typeof createMilestone> | null = null;
    for (let i = 0; i < projectConfig.milestones.length; i++) {
      const m = projectConfig.milestones[i];
      const milestone = createMilestone({
        project_id: project.id,
        title: m.title,
        description: m.description,
        order_index: i,
      });
      if (i === 0) firstMilestone = milestone;
    }

    // Set current milestone to first one
    if (firstMilestone) {
      updateProject(project.id, { current_milestone_id: firstMilestone.id });
    }

    console.log(`\n✅ Project initialized successfully!\n`);
    console.log(`  ID:       ${project.id}`);
    console.log(`  Path:     ${projectPath}`);
    console.log(`  Overview: ${overviewPath}`);
    console.log(`  Milestones: ${projectConfig.milestones.length}`);
    console.log(`\n🚀 To start the agent:`);
    console.log(`  coding-agent run ${project.id}`);
    console.log(`\n💡 Or with npm:`);
    console.log(`  npm run dev -- run ${project.id}`);
  });

program
  .command('run <project-id>')
  .description('Run one orchestrator session')
  .action(async (projectId: string) => {
    const project = getProject(projectId);
    if (!project) {
      console.error(`Project not found: ${projectId}`);
      process.exit(1);
    }

    const result = await runOrchestrator(projectId);

    console.log('\n=== Run Complete ===');
    console.log(`Success: ${result.success}`);
    console.log(`Run ID: ${result.runId}`);
    console.log(`Task ID: ${result.taskId || 'none'}`);
    console.log(`Commit: ${result.commitSha || 'none'}`);
    console.log(`Summary: ${result.summary}`);

    process.exit(result.success ? 0 : 1);
  });

program
  .command('list')
  .description('List all projects')
  .action(() => {
    const projects = getAllProjects();

    if (projects.length === 0) {
      console.log('No projects found. Create one with: coding-agent init <name>');
      return;
    }

    console.log('Projects:\n');
    for (const project of projects) {
      console.log(`  ${project.id}`);
      console.log(`    Name: ${project.name}`);
      console.log(`    Path: ${project.path}`);
      console.log('');
    }
  });

program
  .command('status <project-id>')
  .description('Show project status')
  .action((projectId: string) => {
    const project = getProject(projectId);
    if (!project) {
      console.error(`Project not found: ${projectId}`);
      process.exit(1);
    }

    const tasks = getTasksByProject(projectId);
    const runs = getRunsByProject(projectId, 10);

    console.log(`\nProject: ${project.name}`);
    console.log(`Path: ${project.path}`);
    console.log(`\nTasks (${tasks.length} total):`);

    const statusCounts: Record<string, number> = {};
    for (const task of tasks) {
      statusCounts[task.status] = (statusCounts[task.status] || 0) + 1;
    }

    for (const [status, count] of Object.entries(statusCounts)) {
      console.log(`  ${status}: ${count}`);
    }

    console.log(`\nRecent runs:`);
    for (const run of runs.slice(0, 5)) {
      console.log(`  ${run.id.slice(0, 8)} | ${run.status} | ${run.started_at}`);
    }
  });

program
  .command('tasks <project-id>')
  .description('List all tasks for a project')
  .action((projectId: string) => {
    const project = getProject(projectId);
    if (!project) {
      console.error(`Project not found: ${projectId}`);
      process.exit(1);
    }

    const tasks = getTasksByProject(projectId);

    if (tasks.length === 0) {
      console.log('No tasks yet. Run the orchestrator to generate tasks.');
      return;
    }

    console.log(`\nTasks for ${project.name}:\n`);
    for (const task of tasks) {
      const statusIcon =
        task.status === 'completed' ? '✓' :
        task.status === 'failed' ? '✗' :
        task.status === 'in_progress' ? '→' :
        task.status === 'review' ? '?' : '○';

      console.log(`${statusIcon} [${task.status}] ${task.title}`);
      console.log(`  ID: ${task.id}`);
      if (task.retry_count > 0) {
        console.log(`  Retries: ${task.retry_count}`);
      }
      console.log('');
    }
  });

program
  .command('logs <run-id>')
  .description('Show logs for a run')
  .action((runId: string) => {
    const logs = getLogsByRun(runId);

    if (logs.length === 0) {
      console.log('No logs found for this run.');
      return;
    }

    console.log(`\nLogs for run ${runId}:\n`);
    for (const log of logs) {
      console.log(`[${log.timestamp}] ${log.agent.toUpperCase()} - ${log.event}`);
      if (log.prompt) {
        console.log(`  Prompt: ${log.prompt.slice(0, 100)}...`);
      }
      if (log.response) {
        console.log(`  Response: ${log.response.slice(0, 100)}...`);
      }
      console.log('');
    }
  });

program.parse();

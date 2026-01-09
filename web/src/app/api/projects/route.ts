import { NextResponse } from 'next/server';
import { getAllProjects, getProjectStats, createProject, getProjectByPath, createMilestone, updateProject, type ImportMode } from '@/lib/db';
import { resolve, join } from 'path';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { validateRepositorySource, cloneRepository, extractRepoName, shortId } from '@/lib/git-utils';

// Path to projects directory (relative to web directory)
const PROJECTS_DIR = resolve(process.cwd(), '../projects');
// Path to reference repos directory (for 'reference' mode imports)
const REFERENCE_REPOS_DIR = resolve(process.cwd(), '../reference-repos');

export async function GET() {
  try {
    const projects = getAllProjects();

    // Enrich with stats
    const enrichedProjects = projects.map((project) => ({
      ...project,
      stats: getProjectStats(project.id),
    }));

    return NextResponse.json(enrichedProjects);
  } catch (error) {
    console.error('Error fetching projects:', error);
    return NextResponse.json(
      { error: 'Failed to fetch projects' },
      { status: 500 }
    );
  }
}

// POST - Create new project
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      name,
      description,
      milestones = [],
      use_knowledge = 0,
      cron_enabled = 0,
      cron_schedule = '0 */3 * * *',
      // Import-related fields
      creation_mode = 'new', // 'new' | 'import'
      import_mode, // 'in_place' | 'reference' (required if creation_mode = 'import')
      repository_source, // GitHub URL or local path
    } = body;

    if (!name) {
      return NextResponse.json(
        { error: 'name is required' },
        { status: 400 }
      );
    }

    // Handle import mode
    if (creation_mode === 'import') {
      return handleImportProject({
        name,
        description: description || 'An imported project',
        import_mode: import_mode as ImportMode,
        repository_source,
        use_knowledge,
        cron_enabled,
        cron_schedule,
        milestones,
      });
    }

    // Standard new project creation
    const sanitizedName = name.toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-');
    const projectPath = resolve(PROJECTS_DIR, sanitizedName);

    // Check if project already exists
    const existing = getProjectByPath(projectPath);
    if (existing) {
      return NextResponse.json(
        { error: 'Project already exists at this path' },
        { status: 409 }
      );
    }

    // Create project directory
    mkdirSync(projectPath, { recursive: true });

    // Initialize git repository
    try {
      if (!existsSync(join(projectPath, '.git'))) {
        execSync('git init', { cwd: projectPath, stdio: 'pipe' });
      }
    } catch (gitError) {
      console.warn('Failed to initialize git:', gitError);
    }

    // Generate project overview
    const overviewPath = join(projectPath, 'project_overview.md');
    const overviewContent = generateProjectOverview({
      name,
      description: description || 'A new project',
      milestones,
    });
    writeFileSync(overviewPath, overviewContent);

    // Create project in database
    const project = createProject({
      name,
      path: projectPath,
      overview_path: overviewPath,
      use_knowledge,
      cron_enabled,
      cron_schedule,
    });

    // Create milestones if provided
    let firstMilestone = null;
    for (let i = 0; i < milestones.length; i++) {
      const m = milestones[i];
      const milestone = createMilestone({
        project_id: project.id,
        title: m.title,
        description: m.description || '',
      });
      if (i === 0) firstMilestone = milestone;
    }

    // Set current milestone to first one
    if (firstMilestone) {
      updateProject(project.id, { current_milestone_id: firstMilestone.id });
    }

    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    console.error('Error creating project:', error);
    return NextResponse.json(
      { error: 'Failed to create project' },
      { status: 500 }
    );
  }
}

// Handle import project creation
async function handleImportProject(params: {
  name: string;
  description: string;
  import_mode: ImportMode;
  repository_source: string;
  use_knowledge: number;
  cron_enabled: number;
  cron_schedule: string;
  milestones: Array<{ title: string; description?: string }>;
}) {
  const {
    name,
    description,
    import_mode,
    repository_source,
    use_knowledge,
    cron_enabled,
    cron_schedule,
    milestones,
  } = params;

  // Validate import mode
  if (!import_mode || !['in_place', 'reference'].includes(import_mode)) {
    return NextResponse.json(
      { error: 'import_mode must be "in_place" or "reference"' },
      { status: 400 }
    );
  }

  if (!repository_source) {
    return NextResponse.json(
      { error: 'repository_source is required for import mode' },
      { status: 400 }
    );
  }

  // Validate repository source
  const validation = validateRepositorySource(repository_source);
  if (!validation.valid) {
    return NextResponse.json(
      { error: validation.error || 'Invalid repository source' },
      { status: 400 }
    );
  }

  const sanitizedName = name.toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-');
  let projectPath: string;
  let referencePath: string | null = null;
  let repositoryUrl: string | null = null;

  try {
    if (import_mode === 'in_place') {
      // Work directly on the existing/cloned repo
      if (validation.type === 'github') {
        // Clone to projects directory
        projectPath = resolve(PROJECTS_DIR, sanitizedName);
        if (existsSync(projectPath)) {
          return NextResponse.json(
            { error: 'Project directory already exists' },
            { status: 409 }
          );
        }
        cloneRepository(repository_source, projectPath);
        repositoryUrl = repository_source;
      } else {
        // Use local path directly
        projectPath = repository_source;
      }
    } else {
      // Reference mode: create new project, reference existing repo
      projectPath = resolve(PROJECTS_DIR, sanitizedName);

      if (existsSync(projectPath)) {
        return NextResponse.json(
          { error: 'Project directory already exists' },
          { status: 409 }
        );
      }

      // Create new project directory
      mkdirSync(projectPath, { recursive: true });

      // Initialize git in new directory
      try {
        execSync('git init', { cwd: projectPath, stdio: 'pipe' });
      } catch (gitError) {
        console.warn('Failed to initialize git:', gitError);
      }

      if (validation.type === 'github') {
        // Clone reference repo to reference-repos directory
        mkdirSync(REFERENCE_REPOS_DIR, { recursive: true });
        const repoName = extractRepoName(repository_source);
        referencePath = resolve(REFERENCE_REPOS_DIR, `${repoName}-${shortId()}`);
        cloneRepository(repository_source, referencePath);
        repositoryUrl = repository_source;
      } else {
        // Use local path as reference (don't clone, just reference)
        referencePath = repository_source;
      }
    }

    // Check if project already exists in database
    const existing = getProjectByPath(projectPath);
    if (existing) {
      return NextResponse.json(
        { error: 'Project already exists at this path' },
        { status: 409 }
      );
    }

    // Generate project overview with import context
    const overviewPath = join(projectPath, 'project_overview.md');
    const overviewContent = generateImportedProjectOverview({
      name,
      description,
      import_mode,
      repository_source,
      referencePath,
      milestones,
    });
    writeFileSync(overviewPath, overviewContent);

    // Create project in database
    const project = createProject({
      name,
      path: projectPath,
      overview_path: overviewPath,
      use_knowledge,
      cron_enabled,
      cron_schedule,
      import_mode,
      reference_path: referencePath,
      repository_url: repositoryUrl,
    });

    // Create milestones if provided
    let firstMilestone = null;
    for (let i = 0; i < milestones.length; i++) {
      const m = milestones[i];
      const milestone = createMilestone({
        project_id: project.id,
        title: m.title,
        description: m.description || '',
      });
      if (i === 0) firstMilestone = milestone;
    }

    // Set current milestone to first one
    if (firstMilestone) {
      updateProject(project.id, { current_milestone_id: firstMilestone.id });
    }

    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    console.error('Error importing project:', error);
    const message = error instanceof Error ? error.message : 'Failed to import project';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

function generateProjectOverview(config: { name: string; description: string; milestones: Array<{ title: string; description?: string }> }): string {
  let milestonesSection = '';
  if (config.milestones.length > 0) {
    for (const milestone of config.milestones) {
      milestonesSection += `\n### ${milestone.title}\n`;
      milestonesSection += `${milestone.description || 'No description provided.'}\n`;
    }
  } else {
    milestonesSection = '\n_No milestones defined yet._\n';
  }

  return `# ${config.name}

## Project Description
${config.description}

## Milestones
${milestonesSection}
## Development Guidelines

### Code Style
- Follow the conventions of the chosen tech stack
- Write clean, readable, and maintainable code
- Add comments only where the logic is not self-evident

### Architecture
- Keep the codebase modular and well-organized
- Separate concerns appropriately
- Use consistent naming conventions

### Testing
- Write tests for critical functionality
- Ensure the build passes before considering a task complete

## Notes
- Each milestone should be completed before moving to the next
- Tasks should be small enough to complete in one session
- Focus on functionality first, then polish
`;
}

function generateImportedProjectOverview(config: {
  name: string;
  description: string;
  import_mode: ImportMode;
  repository_source: string;
  referencePath: string | null;
  milestones: Array<{ title: string; description?: string }>;
}): string {
  let milestonesSection = '';
  if (config.milestones.length > 0) {
    for (const milestone of config.milestones) {
      milestonesSection += `\n### ${milestone.title}\n`;
      milestonesSection += `${milestone.description || 'No description provided.'}\n`;
    }
  } else {
    milestonesSection = '\n_No milestones defined yet. Use the AI Planner to generate milestones based on the codebase._\n';
  }

  const importModeLabel = config.import_mode === 'in_place' ? 'Work in Place' : 'Reference Only';

  const developmentGuidelines = config.import_mode === 'in_place'
    ? `### Working with Existing Code
- This is an EXISTING repository - explore and understand the current structure before making changes
- Respect existing patterns, naming conventions, and architecture
- Be cautious with breaking changes to existing functionality
- Review the current codebase to understand what's already implemented
- Build upon existing work rather than rewriting from scratch

### Code Style
- Follow the conventions already established in the codebase
- Match the existing code style and patterns
- Add comments only where the logic is not self-evident

### Testing
- Ensure existing tests still pass after changes
- Write tests for new functionality
- Verify the build passes before considering a task complete`
    : `### Working with Reference Repository
- A reference codebase is available at: ${config.referencePath}
- You have READ access to the reference repository for learning patterns and approaches
- Use the Read tool or Bash tool to explore reference code when needed
- Adapt and learn from the reference patterns - don't copy blindly
- This is a NEW project - build fresh but informed by the reference

### Code Style
- Learn patterns from the reference codebase
- Establish consistent conventions for this new project
- Add comments only where the logic is not self-evident

### Architecture
- Study the reference architecture for inspiration
- Adapt patterns that work well for this project's needs
- Keep the codebase modular and well-organized

### Testing
- Write tests for critical functionality
- Ensure the build passes before considering a task complete`;

  return `# ${config.name}

## Project Description
${config.description}

## Repository Information
- **Import Mode**: ${importModeLabel}
- **Original Repository**: ${config.repository_source}
${config.referencePath ? `- **Reference Path**: ${config.referencePath}\n` : ''}
## What to Work On
${config.description}

## Milestones
${milestonesSection}
## Development Guidelines

${developmentGuidelines}

## Notes
- First explore the ${config.import_mode === 'in_place' ? 'existing codebase' : 'reference repository'} to understand its structure
- Tasks should be small enough to complete in one session
- Focus on functionality first, then polish
`;
}

import { createProject, updateProject, getProjectByPath } from '../src/db/projects.js';
import { createMilestone, getMilestonesByProject } from '../src/db/milestones.js';

const PROJECT_PATH = '/home/razvan/Work/codingAgent/projects/progress-tracker';
const OVERVIEW_PATH = `${PROJECT_PATH}/project_overview.md`;

const milestones = [
  {
    title: 'Project Scaffolding & Core Setup',
    description: 'Initialize Expo project with TypeScript, configure dependencies, establish folder structure, set up Expo Router with tab navigation, configure NativeWind styling, and define base theme.',
  },
  {
    title: 'Local Database & State Management',
    description: 'Implement offline-first SQLite database with schema for projects, entries, reports, and sync queue. Create Zustand stores and custom hooks (useProject, useEntries) for data access.',
  },
  {
    title: 'Authentication & User Management',
    description: 'Implement Supabase auth with email/password, Google OAuth, and Apple Sign-In. Create onboarding flow, profile screen, and secure token storage.',
  },
  {
    title: 'Project Management UI',
    description: 'Build project list (home), create project wizard, project detail screen with stats, edit/delete functionality, category selection, and cover image picker.',
  },
  {
    title: 'Media Capture & Entry Creation',
    description: 'Implement camera screen with video/photo toggle, video recording (max 3 min), photo capture, text entries, media preview, thumbnail generation, and compression.',
  },
  {
    title: 'Timeline View & Entry Management',
    description: 'Build visual timeline component, entry cards (video/photo/text), full-screen media viewer, calendar view option, entry filtering, and date-grouped sorting.',
  },
  {
    title: 'Cloud Sync & Media Upload',
    description: 'Integrate Cloudflare R2 via Supabase Edge Functions, implement chunked video upload with progress, background upload queue with retry logic, and offline/online handling.',
  },
  {
    title: 'Push Notifications & Reminders',
    description: 'Set up expo-notifications, implement per-project reminder scheduling (time + days), push notification registration, deep linking on tap, and permission flow.',
  },
  {
    title: 'Monthly Reports Generation',
    description: 'Create report generation logic (first vs last entry comparison), side-by-side comparison view, progress statistics, report sharing, and Supabase scheduled function for auto-generation.',
  },
  {
    title: 'Polish, Testing & App Store Prep',
    description: 'Error boundaries, crash reporting (Sentry), performance optimization, accessibility audit, unit/E2E tests, app icons, splash screen, and EAS Build configuration.',
  },
  {
    title: 'Continuous Improvement (Never Complete)',
    description: 'Research similar apps (Day One, Journey, Momento, 1 Second Everyday, Gyroscope) and identify new features. This perpetual milestone allows for continuous market research, UX improvements, and feature discovery. This milestone should never be marked as completed.',
  },
];

async function main() {
  console.log('Setting up Progress Tracker project...\n');

  // Check if project already exists
  let project = getProjectByPath(PROJECT_PATH);

  if (project) {
    console.log(`Project already exists with ID: ${project.id}`);
  } else {
    // Create the project
    project = createProject({
      name: 'Progress Tracker',
      path: PROJECT_PATH,
      overview_path: OVERVIEW_PATH,
    });
    console.log(`Created project with ID: ${project.id}`);
  }

  // Update project settings: cron_enabled = 0, use_knowledge = 0
  updateProject(project.id, {
    cron_enabled: 0,
    use_knowledge: 0,
  });
  console.log('Updated project settings: cron_enabled=0, use_knowledge=0');

  // Check existing milestones
  const existingMilestones = getMilestonesByProject(project.id, true);
  if (existingMilestones.length > 0) {
    console.log(`\nProject already has ${existingMilestones.length} milestones:`);
    existingMilestones.forEach((m, i) => {
      console.log(`  ${i + 1}. ${m.title} (${m.status})`);
    });
    console.log('\nSkipping milestone creation. Delete existing milestones first if you want to recreate them.');
  } else {
    // Create milestones
    console.log('\nCreating milestones...');
    let firstMilestoneId: string | null = null;

    for (let i = 0; i < milestones.length; i++) {
      const m = createMilestone({
        project_id: project.id,
        title: milestones[i].title,
        description: milestones[i].description,
        order_index: i,
      });
      console.log(`  ${i + 1}. Created: ${m.title}`);

      if (i === 0) {
        firstMilestoneId = m.id;
      }
    }

    // Set current milestone to first one
    if (firstMilestoneId) {
      updateProject(project.id, { current_milestone_id: firstMilestoneId });
      console.log('\nSet current milestone to: Project Scaffolding & Core Setup');
    }
  }

  console.log('\n✓ Progress Tracker project setup complete!');
  console.log(`\nProject ID: ${project.id}`);
  console.log(`Path: ${PROJECT_PATH}`);
  console.log('\nThe project is configured to NOT run automatically (cron_enabled=0).');
  console.log('Review the milestones in the web UI before starting work.');
}

main().catch(console.error);

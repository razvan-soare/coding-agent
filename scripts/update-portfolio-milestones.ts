import { getDb } from '../src/db/client.js';
import { initializeSchema } from '../src/db/schema.js';
import { createMilestone, getMilestonesByProject } from '../src/db/milestones.js';
import { updateProject, getProjectByPath } from '../src/db/projects.js';

initializeSchema();

const PROJECT_PATH = '/home/razvan/Work/codingAgent/projects/razvan-portfolio';

const project = getProjectByPath(PROJECT_PATH);
if (!project) {
  console.error('Project not found');
  process.exit(1);
}

console.log(`Found project: ${project.name} (${project.id})`);

// Delete existing milestones
const db = getDb();
db.prepare('DELETE FROM milestones WHERE project_id = ?').run(project.id);
console.log('Deleted existing milestones');

// Create new milestones
const milestones = [
  {
    title: 'Foundation & Core Layout',
    description: 'Set up the project structure and implement the basic layout components. Initialize Next.js 14 with App Router, configure Tailwind CSS and shadcn/ui, create root layout with dark theme, implement responsive navigation header and footer, set up Framer Motion for animations.',
  },
  {
    title: 'Home Page & Animated Character',
    description: 'Build the hero section with the signature animated character. Create hero section layout, implement animated stick figure SVG component with floating/bobbing animation, hand wave on hover, thought bubbles with rotating messages. Build Recently Published section with post cards and featured projects preview.',
  },
  {
    title: 'Content Pages',
    description: 'Implement About, Projects, and Blog pages. Create About page with bio content and social links. Build Projects page with grid layout and project cards with hover effects. Implement Blog/Snippets listing page with category filtering. Create individual project and blog post page templates.',
  },
  {
    title: 'Data Layer & Polish',
    description: 'Set up data fetching and add finishing touches. Configure TanStack Query, create static data files for projects and blog posts, implement loading skeletons, add page transition animations, staggered list animations, SEO optimization, mobile responsiveness, and 404 page.',
  },
];

let firstMilestone: ReturnType<typeof createMilestone> | null = null;
for (let i = 0; i < milestones.length; i++) {
  const m = createMilestone({
    project_id: project.id,
    title: milestones[i].title,
    description: milestones[i].description,
    order_index: i,
  });
  console.log(`Created milestone: ${m.title}`);
  if (i === 0) firstMilestone = m;
}

// Set current milestone
if (firstMilestone) {
  updateProject(project.id, { current_milestone_id: firstMilestone.id });
  console.log(`Set current milestone to: ${firstMilestone.title}`);
}

console.log('\nDone! Milestones updated.');
console.log(`\nProject ID: ${project.id}`);
console.log(`Run with: npm run dev -- run ${project.id}`);

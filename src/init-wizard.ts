import prompts from 'prompts';

export interface ProjectConfig {
  name: string;
  description: string;
  projectType: string;
  techStack: string[];
  features: string[];
  milestones: MilestoneConfig[];
}

export interface MilestoneConfig {
  title: string;
  description: string;
  features: string[];
}

const PROJECT_TYPES = [
  { title: 'Web Application', value: 'webapp', description: 'Frontend web app (React, Vue, etc.)' },
  { title: 'Full-Stack App', value: 'fullstack', description: 'Frontend + Backend + Database' },
  { title: 'API/Backend', value: 'api', description: 'REST or GraphQL API service' },
  { title: 'CLI Tool', value: 'cli', description: 'Command-line application' },
  { title: 'Library/Package', value: 'library', description: 'Reusable code package' },
  { title: 'Mobile App', value: 'mobile', description: 'React Native, Flutter, etc.' },
  { title: 'Other', value: 'other', description: 'Something else' },
];

const TECH_STACKS: Record<string, Array<{ title: string; value: string }>> = {
  webapp: [
    { title: 'React + TypeScript', value: 'react-ts' },
    { title: 'Next.js', value: 'nextjs' },
    { title: 'Vue.js', value: 'vue' },
    { title: 'Svelte', value: 'svelte' },
    { title: 'Vanilla JS/HTML/CSS', value: 'vanilla' },
  ],
  fullstack: [
    { title: 'Next.js + Prisma + PostgreSQL', value: 'nextjs-prisma' },
    { title: 'React + Node.js + Express + MongoDB', value: 'mern' },
    { title: 'React + Node.js + Express + PostgreSQL', value: 'pern' },
    { title: 'T3 Stack (Next.js + tRPC + Prisma)', value: 't3' },
  ],
  api: [
    { title: 'Node.js + Express + TypeScript', value: 'express-ts' },
    { title: 'Node.js + Fastify', value: 'fastify' },
    { title: 'Python + FastAPI', value: 'fastapi' },
    { title: 'Go + Gin', value: 'go-gin' },
  ],
  cli: [
    { title: 'Node.js + TypeScript + Commander', value: 'node-cli' },
    { title: 'Python + Click', value: 'python-click' },
    { title: 'Rust + Clap', value: 'rust-clap' },
    { title: 'Go + Cobra', value: 'go-cobra' },
  ],
  library: [
    { title: 'TypeScript (npm package)', value: 'ts-npm' },
    { title: 'Python (pip package)', value: 'python-pip' },
    { title: 'Rust (crates.io)', value: 'rust-crate' },
  ],
  mobile: [
    { title: 'React Native + TypeScript', value: 'react-native' },
    { title: 'Flutter + Dart', value: 'flutter' },
    { title: 'Expo (React Native)', value: 'expo' },
  ],
  other: [
    { title: 'Custom / Will specify in description', value: 'custom' },
  ],
};

export async function runInitWizard(defaultName?: string): Promise<ProjectConfig | null> {
  console.log('\n🚀 Project Setup Wizard\n');
  console.log('Answer a few questions to generate your project configuration.\n');

  // Basic info
  const basicInfo = await prompts([
    {
      type: 'text',
      name: 'name',
      message: 'Project name:',
      initial: defaultName,
      validate: (value) => value.length > 0 || 'Name is required',
    },
    {
      type: 'text',
      name: 'description',
      message: 'Describe your project (what problem does it solve?):',
      validate: (value) => value.length > 10 || 'Please provide a meaningful description',
    },
  ]);

  if (!basicInfo.name) return null;

  // Project type
  const typeChoice = await prompts({
    type: 'select',
    name: 'projectType',
    message: 'What type of project is this?',
    choices: PROJECT_TYPES,
  });

  if (!typeChoice.projectType) return null;

  // Tech stack based on project type
  const stackChoices = TECH_STACKS[typeChoice.projectType] || TECH_STACKS.other;
  const stackChoice = await prompts({
    type: 'select',
    name: 'stack',
    message: 'Select your tech stack:',
    choices: stackChoices,
  });

  if (!stackChoice.stack) return null;

  // Additional technologies
  const additionalTech = await prompts({
    type: 'text',
    name: 'additional',
    message: 'Any additional technologies? (comma-separated, or press Enter to skip):',
  });

  const techStack = [stackChoice.stack];
  if (additionalTech.additional) {
    techStack.push(...additionalTech.additional.split(',').map((t: string) => t.trim()));
  }

  // Features
  console.log('\n📋 Now let\'s define the main features of your project.\n');

  const features: string[] = [];
  let addingFeatures = true;

  while (addingFeatures) {
    const feature = await prompts({
      type: 'text',
      name: 'feature',
      message: `Feature ${features.length + 1} (or press Enter when done):`,
    });

    if (feature.feature && feature.feature.trim()) {
      features.push(feature.feature.trim());
    } else {
      if (features.length === 0) {
        console.log('Please add at least one feature.');
      } else {
        addingFeatures = false;
      }
    }
  }

  // Milestones
  console.log('\n🎯 Let\'s organize features into milestones.\n');

  const milestoneStrategy = await prompts({
    type: 'select',
    name: 'strategy',
    message: 'How would you like to create milestones?',
    choices: [
      { title: 'Auto-generate (recommended)', value: 'auto', description: 'Let AI organize features into logical milestones' },
      { title: 'Simple (MVP + Enhancements)', value: 'simple', description: 'Two milestones: core features first, then extras' },
      { title: 'Manual', value: 'manual', description: 'Define milestones yourself' },
    ],
  });

  let milestones: MilestoneConfig[] = [];

  if (milestoneStrategy.strategy === 'auto') {
    milestones = autoGenerateMilestones(features, typeChoice.projectType);
  } else if (milestoneStrategy.strategy === 'simple') {
    milestones = generateSimpleMilestones(features);
  } else {
    milestones = await manualMilestoneSetup(features);
  }

  // Confirm
  console.log('\n📝 Project Summary:\n');
  console.log(`  Name: ${basicInfo.name}`);
  console.log(`  Type: ${typeChoice.projectType}`);
  console.log(`  Stack: ${techStack.join(', ')}`);
  console.log(`  Features: ${features.length}`);
  console.log(`  Milestones: ${milestones.length}`);

  for (const m of milestones) {
    console.log(`\n  📌 ${m.title}`);
    console.log(`     ${m.description}`);
    console.log(`     Features: ${m.features.join(', ')}`);
  }

  const confirm = await prompts({
    type: 'confirm',
    name: 'proceed',
    message: '\nLooks good?',
    initial: true,
  });

  if (!confirm.proceed) {
    console.log('Setup cancelled.');
    return null;
  }

  return {
    name: basicInfo.name,
    description: basicInfo.description,
    projectType: typeChoice.projectType,
    techStack,
    features,
    milestones,
  };
}

function autoGenerateMilestones(features: string[], projectType: string): MilestoneConfig[] {
  // Heuristic: divide features into 3 milestones
  // 1. Foundation/Setup (first ~30%)
  // 2. Core Features (next ~50%)
  // 3. Polish/Enhancements (remaining ~20%)

  const total = features.length;

  if (total <= 3) {
    return [{
      title: 'MVP',
      description: 'Complete all core features',
      features: [...features],
    }];
  }

  const foundationCount = Math.max(1, Math.ceil(total * 0.3));
  const coreCount = Math.max(1, Math.ceil(total * 0.5));

  const foundation = features.slice(0, foundationCount);
  const core = features.slice(foundationCount, foundationCount + coreCount);
  const polish = features.slice(foundationCount + coreCount);

  const milestones: MilestoneConfig[] = [
    {
      title: 'Foundation',
      description: 'Project setup and basic structure',
      features: foundation,
    },
    {
      title: 'Core Features',
      description: 'Main functionality implementation',
      features: core,
    },
  ];

  if (polish.length > 0) {
    milestones.push({
      title: 'Polish & Enhancements',
      description: 'Refinements, optimizations, and additional features',
      features: polish,
    });
  }

  return milestones;
}

function generateSimpleMilestones(features: string[]): MilestoneConfig[] {
  const mid = Math.ceil(features.length / 2);

  return [
    {
      title: 'MVP',
      description: 'Minimum viable product with core functionality',
      features: features.slice(0, mid),
    },
    {
      title: 'Enhancements',
      description: 'Additional features and improvements',
      features: features.slice(mid),
    },
  ];
}

async function manualMilestoneSetup(features: string[]): Promise<MilestoneConfig[]> {
  const milestones: MilestoneConfig[] = [];
  const remainingFeatures = [...features];

  console.log('\nAvailable features:', features.map((f, i) => `\n  ${i + 1}. ${f}`).join(''));

  let addingMilestones = true;
  while (addingMilestones && remainingFeatures.length > 0) {
    const milestone = await prompts([
      {
        type: 'text',
        name: 'title',
        message: `Milestone ${milestones.length + 1} title:`,
        validate: (v) => v.length > 0 || 'Title required',
      },
      {
        type: 'text',
        name: 'description',
        message: 'Brief description:',
      },
    ]);

    if (!milestone.title) break;

    console.log('\nSelect features for this milestone (comma-separated numbers):');
    remainingFeatures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));

    const featureSelection = await prompts({
      type: 'text',
      name: 'indices',
      message: 'Feature numbers:',
    });

    const indices = featureSelection.indices
      .split(',')
      .map((s: string) => parseInt(s.trim()) - 1)
      .filter((i: number) => i >= 0 && i < remainingFeatures.length);

    const selectedFeatures = indices.map((i: number) => remainingFeatures[i]);

    // Remove selected features from remaining
    for (let i = indices.length - 1; i >= 0; i--) {
      remainingFeatures.splice(indices[i], 1);
    }

    milestones.push({
      title: milestone.title,
      description: milestone.description || '',
      features: selectedFeatures,
    });

    if (remainingFeatures.length > 0) {
      const continueAdding = await prompts({
        type: 'confirm',
        name: 'continue',
        message: `${remainingFeatures.length} features remaining. Add another milestone?`,
        initial: true,
      });
      addingMilestones = continueAdding.continue;
    } else {
      addingMilestones = false;
    }
  }

  // Add any remaining features to last milestone
  if (remainingFeatures.length > 0 && milestones.length > 0) {
    milestones[milestones.length - 1].features.push(...remainingFeatures);
  }

  return milestones;
}

export function generateProjectOverview(config: ProjectConfig): string {
  const techStackList = config.techStack.map(t => `- ${t}`).join('\n');
  const featuresList = config.features.map((f, i) => `${i + 1}. ${f}`).join('\n');

  let milestonesSection = '';
  for (const milestone of config.milestones) {
    milestonesSection += `\n### ${milestone.title}\n`;
    milestonesSection += `${milestone.description}\n\n`;
    milestonesSection += 'Features:\n';
    milestonesSection += milestone.features.map(f => `- ${f}`).join('\n');
    milestonesSection += '\n';
  }

  return `# ${config.name}

## Project Description
${config.description}

## Project Type
${config.projectType}

## Tech Stack
${techStackList}

## Features Overview
${featuresList}

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

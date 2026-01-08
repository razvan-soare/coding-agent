import { NextResponse } from 'next/server';
import { getMilestonesByProject, createMilestone, type MilestoneStatus } from '@/lib/db';

// GET - List milestones for a project
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('project_id');
    const includeArchived = searchParams.get('include_archived') === 'true';

    if (!projectId) {
      return NextResponse.json(
        { error: 'project_id is required' },
        { status: 400 }
      );
    }

    const milestones = getMilestonesByProject(projectId, includeArchived);

    return NextResponse.json({ milestones });
  } catch (error) {
    console.error('Error fetching milestones:', error);
    return NextResponse.json(
      { error: 'Failed to fetch milestones' },
      { status: 500 }
    );
  }
}

// POST - Create new milestone
export async function POST(request: Request) {
  try {
    const body = await request.json();

    const { project_id, title, description } = body;

    if (!project_id || !title) {
      return NextResponse.json(
        { error: 'project_id and title are required' },
        { status: 400 }
      );
    }

    const milestone = createMilestone({
      project_id,
      title,
      description,
    });

    return NextResponse.json({ milestone }, { status: 201 });
  } catch (error) {
    console.error('Error creating milestone:', error);
    return NextResponse.json(
      { error: 'Failed to create milestone' },
      { status: 500 }
    );
  }
}

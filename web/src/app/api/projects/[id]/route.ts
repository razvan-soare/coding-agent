import { NextResponse } from 'next/server';
import { getProject, getProjectStats, getTasksByProject, getRunsByProject, updateProject } from '@/lib/db';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const project = getProject(id);

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    const stats = getProjectStats(id);
    const tasks = getTasksByProject(id);
    const runs = getRunsByProject(id, 10);

    return NextResponse.json({
      ...project,
      stats,
      tasks,
      runs,
    });
  } catch (error) {
    console.error('Error fetching project:', error);
    return NextResponse.json(
      { error: 'Failed to fetch project' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const updateData: Parameters<typeof updateProject>[1] = {};

    if (body.use_knowledge !== undefined) {
      updateData.use_knowledge = body.use_knowledge;
    }
    if (body.cron_enabled !== undefined) {
      updateData.cron_enabled = body.cron_enabled;
    }
    if (body.cron_schedule !== undefined) {
      updateData.cron_schedule = body.cron_schedule;
    }
    if (body.repository_url !== undefined) {
      updateData.repository_url = body.repository_url;
    }
    if (body.git_author_name !== undefined) {
      updateData.git_author_name = body.git_author_name;
    }
    if (body.git_author_email !== undefined) {
      updateData.git_author_email = body.git_author_email;
    }

    const project = updateProject(id, updateData);

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    // If cron settings changed, update the cron service
    if (body.cron_enabled !== undefined || body.cron_schedule !== undefined) {
      const { updateCronJob, ensureCronInitialized } = await import('@/lib/cron');
      ensureCronInitialized();
      updateCronJob(id, project.cron_enabled === 1, project.cron_schedule);
    }

    return NextResponse.json(project);
  } catch (error) {
    console.error('Error updating project:', error);
    return NextResponse.json(
      { error: 'Failed to update project' },
      { status: 500 }
    );
  }
}

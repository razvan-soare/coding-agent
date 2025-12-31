import { NextResponse } from 'next/server';
import { getProject, getProjectStats, getTasksByProject, getRunsByProject } from '@/lib/db';

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

import { NextResponse } from 'next/server';
import { getTasksByProject, createInjectedTask } from '@/lib/db';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('project_id');

    if (!projectId) {
      return NextResponse.json(
        { error: 'project_id is required' },
        { status: 400 }
      );
    }

    const tasks = getTasksByProject(projectId);
    return NextResponse.json(tasks);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tasks' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!body.project_id || !body.title || !body.description) {
      return NextResponse.json(
        { error: 'project_id, title, and description are required' },
        { status: 400 }
      );
    }

    const task = createInjectedTask({
      project_id: body.project_id,
      title: body.title,
      description: body.description,
      priority: body.priority ?? 100,
    });

    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    console.error('Error creating task:', error);
    return NextResponse.json(
      { error: 'Failed to create task' },
      { status: 500 }
    );
  }
}

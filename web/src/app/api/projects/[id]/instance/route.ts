import { NextResponse } from 'next/server';
import { getProject } from '@/lib/db';
import { startProject, stopProject, getProjectInstance } from '@/lib/instances';

// GET - Get instance status
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const instance = getProjectInstance(id);

    return NextResponse.json({
      instance: instance || null,
    });
  } catch (error) {
    console.error('Error getting instance:', error);
    return NextResponse.json(
      { error: 'Failed to get instance status' },
      { status: 500 }
    );
  }
}

// POST - Start project
export async function POST(
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

    const instance = startProject(id, project.path);

    return NextResponse.json({
      instance,
      message: instance.status === 'error' ? instance.error : 'Project starting...',
    });
  } catch (error) {
    console.error('Error starting project:', error);
    return NextResponse.json(
      { error: 'Failed to start project' },
      { status: 500 }
    );
  }
}

// DELETE - Stop project
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const instance = stopProject(id);

    if (!instance) {
      return NextResponse.json(
        { error: 'No running instance found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      instance,
      message: 'Project stopped',
    });
  } catch (error) {
    console.error('Error stopping project:', error);
    return NextResponse.json(
      { error: 'Failed to stop project' },
      { status: 500 }
    );
  }
}

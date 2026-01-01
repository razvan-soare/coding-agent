import { NextResponse } from 'next/server';
import { getKnowledgeByProject, createKnowledge, type KnowledgeCategory } from '@/lib/db';

// GET - List knowledge for a project
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

    const knowledge = getKnowledgeByProject(projectId);

    return NextResponse.json({ knowledge });
  } catch (error) {
    console.error('Error fetching knowledge:', error);
    return NextResponse.json(
      { error: 'Failed to fetch knowledge' },
      { status: 500 }
    );
  }
}

// POST - Create new knowledge entry
export async function POST(request: Request) {
  try {
    const body = await request.json();

    const { project_id, category, tags, content, file_path, importance } = body;

    if (!project_id || !category || !content) {
      return NextResponse.json(
        { error: 'project_id, category, and content are required' },
        { status: 400 }
      );
    }

    const validCategories: KnowledgeCategory[] = ['pattern', 'gotcha', 'decision', 'preference', 'file_note'];
    if (!validCategories.includes(category)) {
      return NextResponse.json(
        { error: `Invalid category. Must be one of: ${validCategories.join(', ')}` },
        { status: 400 }
      );
    }

    const knowledge = createKnowledge({
      project_id,
      category,
      tags: tags || [],
      content,
      file_path,
      importance,
    });

    return NextResponse.json({ knowledge }, { status: 201 });
  } catch (error) {
    console.error('Error creating knowledge:', error);
    return NextResponse.json(
      { error: 'Failed to create knowledge' },
      { status: 500 }
    );
  }
}

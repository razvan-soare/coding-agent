import { NextResponse } from 'next/server';
import { getKnowledge, updateKnowledge, deleteKnowledge, type KnowledgeCategory } from '@/lib/db';

// GET - Get single knowledge entry
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const knowledge = getKnowledge(id);

    if (!knowledge) {
      return NextResponse.json(
        { error: 'Knowledge entry not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ knowledge });
  } catch (error) {
    console.error('Error fetching knowledge:', error);
    return NextResponse.json(
      { error: 'Failed to fetch knowledge' },
      { status: 500 }
    );
  }
}

// PATCH - Update knowledge entry
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const { category, tags, content, file_path, importance } = body;

    if (category) {
      const validCategories: KnowledgeCategory[] = ['pattern', 'gotcha', 'decision', 'preference', 'file_note'];
      if (!validCategories.includes(category)) {
        return NextResponse.json(
          { error: `Invalid category. Must be one of: ${validCategories.join(', ')}` },
          { status: 400 }
        );
      }
    }

    const knowledge = updateKnowledge(id, {
      category,
      tags,
      content,
      file_path,
      importance,
    });

    if (!knowledge) {
      return NextResponse.json(
        { error: 'Knowledge entry not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ knowledge });
  } catch (error) {
    console.error('Error updating knowledge:', error);
    return NextResponse.json(
      { error: 'Failed to update knowledge' },
      { status: 500 }
    );
  }
}

// DELETE - Delete knowledge entry
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const deleted = deleteKnowledge(id);

    if (!deleted) {
      return NextResponse.json(
        { error: 'Knowledge entry not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting knowledge:', error);
    return NextResponse.json(
      { error: 'Failed to delete knowledge' },
      { status: 500 }
    );
  }
}

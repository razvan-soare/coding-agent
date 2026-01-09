import { NextResponse } from 'next/server';
import { validateRepositorySource, extractRepoName } from '@/lib/git-utils';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { source } = body;

    if (!source) {
      return NextResponse.json(
        { valid: false, type: null, error: 'source is required' },
        { status: 400 }
      );
    }

    const result = validateRepositorySource(source);

    // Add suggested name if valid
    if (result.valid) {
      return NextResponse.json({
        ...result,
        suggestedName: result.type === 'github'
          ? extractRepoName(source)
          : source.split('/').pop() || 'imported-project',
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error validating repository source:', error);
    return NextResponse.json(
      { valid: false, type: null, error: 'Failed to validate source' },
      { status: 500 }
    );
  }
}

import { NextResponse } from 'next/server';
import { getAllProjects, getProjectStats } from '@/lib/db';

export async function GET() {
  try {
    const projects = getAllProjects();

    // Enrich with stats
    const enrichedProjects = projects.map((project) => ({
      ...project,
      stats: getProjectStats(project.id),
    }));

    return NextResponse.json(enrichedProjects);
  } catch (error) {
    console.error('Error fetching projects:', error);
    return NextResponse.json(
      { error: 'Failed to fetch projects' },
      { status: 500 }
    );
  }
}

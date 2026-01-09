'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useProjects } from '@/lib/hooks/useProjects';
import { formatDate } from '@/lib/utils';
import { Folder, CheckCircle, Clock, AlertCircle, XCircle, Play, Plus } from 'lucide-react';
import CreateProjectDialog from '@/components/CreateProjectDialog';

export default function Dashboard() {
  const { data: projects, isLoading, error } = useProjects();
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // Show skeleton while loading, but don't block if we have cached data
  const showSkeleton = isLoading && !projects;

  if (error) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-8">Coding Agent Dashboard</h1>
        <div className="text-destructive">Failed to load projects</div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">Coding Agent Dashboard</h1>
        <button
          onClick={() => setShowCreateDialog(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Project
        </button>
      </div>

      <CreateProjectDialog
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
      />

      {showSkeleton ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2].map((i) => (
            <div key={i} className="p-6 bg-card rounded-lg border border-border animate-pulse">
              <div className="h-6 bg-muted rounded w-3/4 mb-4" />
              <div className="h-4 bg-muted rounded w-1/2 mb-4" />
              <div className="grid grid-cols-4 gap-2">
                {[1, 2, 3, 4].map((j) => (
                  <div key={j} className="h-8 bg-muted rounded" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : projects?.length === 0 ? (
        <div className="text-center py-12">
          <Folder className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <h3 className="text-lg font-medium mb-2">No projects yet</h3>
          <p className="text-muted-foreground mb-6">
            Create your first project to get started.
          </p>
          <button
            onClick={() => setShowCreateDialog(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create Project
          </button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects?.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="block p-6 bg-card rounded-lg border border-border hover:border-primary transition-colors"
            >
              <div className="flex items-start gap-3 mb-4">
                <Folder className="w-5 h-5 text-primary mt-0.5" />
                <div>
                  <h2 className="font-semibold text-lg">{project.name}</h2>
                  <p className="text-sm text-muted-foreground truncate max-w-[250px]">
                    {project.path}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2 mb-4">
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    <span className="text-sm font-medium">{project.stats.pending}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">Pending</div>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 text-blue-400">
                    <Play className="w-3 h-3" />
                    <span className="text-sm font-medium">{project.stats.in_progress}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">Active</div>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 text-green-400">
                    <CheckCircle className="w-3 h-3" />
                    <span className="text-sm font-medium">{project.stats.completed}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">Done</div>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 text-destructive">
                    <XCircle className="w-3 h-3" />
                    <span className="text-sm font-medium">{project.stats.failed}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">Failed</div>
                </div>
              </div>

              {project.stats.lastRun && (
                <div className="pt-3 border-t border-border">
                  <div className="flex items-center gap-2 text-sm">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        project.stats.lastRun.status === 'running'
                          ? 'bg-blue-400 animate-pulse'
                          : project.stats.lastRun.status === 'completed'
                          ? 'bg-green-400'
                          : 'bg-destructive'
                      }`}
                    />
                    <span className="text-muted-foreground">
                      Last run: {formatDate(project.stats.lastRun.started_at)}
                    </span>
                  </div>
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

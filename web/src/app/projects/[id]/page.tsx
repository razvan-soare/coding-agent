'use client';

import { useState, use } from 'react';
import Link from 'next/link';
import { useProject, useToggleKnowledge } from '@/lib/hooks/useProjects';
import { useCreateTask, useDeleteTask } from '@/lib/hooks/useTasks';
import { useRuns, useLogs, useRunStatus, useTriggerRun } from '@/lib/hooks/useRuns';
import { useInstance, useStartInstance, useStopInstance } from '@/lib/hooks/useInstances';
import { useKnowledge, useCreateKnowledge, useUpdateKnowledge, useDeleteKnowledge, type KnowledgeCategory } from '@/lib/hooks/useKnowledge';
import { formatDate, formatDuration, cn } from '@/lib/utils';
import {
  ArrowLeft,
  Plus,
  Clock,
  Play,
  CheckCircle,
  XCircle,
  AlertCircle,
  Trash2,
  ChevronDown,
  ChevronRight,
  Zap,
  Square,
  ExternalLink,
  Loader2,
  BookOpen,
  Lightbulb,
  FileText,
  Edit2,
  X,
  Save,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';

type Tab = 'tasks' | 'runs' | 'knowledge' | 'preview';

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: project, isLoading, error } = useProject(id);
  const [activeTab, setActiveTab] = useState<Tab>('tasks');

  // Only poll instance status when on Preview tab
  const { data: instance } = useInstance(id, { pollWhileActive: activeTab === 'preview' });
  const startInstance = useStartInstance();
  const stopInstance = useStopInstance();

  // Run status and trigger
  const { data: runStatus } = useRunStatus(id);
  const triggerRun = useTriggerRun();

  const [showTaskForm, setShowTaskForm] = useState(false);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // Show skeleton only on first load, not on refetches
  if (isLoading && !project) {
    return (
      <div className="p-8">
        <div className="mb-8">
          <div className="h-4 w-32 bg-muted rounded animate-pulse mb-4" />
          <div className="h-8 w-64 bg-muted rounded animate-pulse mb-2" />
          <div className="h-4 w-48 bg-muted rounded animate-pulse" />
        </div>
        <div className="flex gap-4 mb-6 border-b border-border pb-3">
          <div className="h-6 w-20 bg-muted rounded animate-pulse" />
          <div className="h-6 w-20 bg-muted rounded animate-pulse" />
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-card border border-border rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="p-8">
        <div className="text-destructive">Failed to load project</div>
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{project.name}</h1>
            <p className="text-muted-foreground text-sm">{project.path}</p>
          </div>
          <button
            onClick={() => triggerRun.mutate(id)}
            disabled={triggerRun.isPending || runStatus?.running}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors',
              runStatus?.running
                ? 'bg-blue-500/20 text-blue-400 cursor-not-allowed'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            )}
          >
            {runStatus?.running ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Running...
              </>
            ) : triggerRun.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Run Agent
              </>
            )}
          </button>
        </div>
        {triggerRun.isError && (
          <p className="mt-2 text-sm text-destructive">
            {triggerRun.error?.message || 'Failed to start run'}
          </p>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-4 mb-6 border-b border-border">
        <button
          onClick={() => setActiveTab('tasks')}
          className={cn(
            'pb-3 px-1 text-sm font-medium transition-colors',
            activeTab === 'tasks'
              ? 'text-primary border-b-2 border-primary'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Tasks ({project.tasks.length})
        </button>
        <button
          onClick={() => setActiveTab('runs')}
          className={cn(
            'pb-3 px-1 text-sm font-medium transition-colors',
            activeTab === 'runs'
              ? 'text-primary border-b-2 border-primary'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Runs ({project.runs.length})
        </button>
        <button
          onClick={() => setActiveTab('knowledge')}
          className={cn(
            'pb-3 px-1 text-sm font-medium transition-colors',
            activeTab === 'knowledge'
              ? 'text-primary border-b-2 border-primary'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <BookOpen className="w-4 h-4 inline-block mr-1" />
          Knowledge
        </button>
        <button
          onClick={() => setActiveTab('preview')}
          className={cn(
            'pb-3 px-1 text-sm font-medium transition-colors',
            activeTab === 'preview'
              ? 'text-primary border-b-2 border-primary'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Preview
          {instance?.status === 'running' && (
            <span className="ml-2 w-2 h-2 rounded-full bg-green-400 inline-block animate-pulse" />
          )}
          {instance?.status === 'orphaned' && (
            <span className="ml-2 w-2 h-2 rounded-full bg-yellow-400 inline-block" />
          )}
        </button>
      </div>

      {/* Content */}
      {activeTab === 'tasks' && (
        <TasksTab
          projectId={id}
          tasks={project.tasks}
          showTaskForm={showTaskForm}
          setShowTaskForm={setShowTaskForm}
          expandedTask={expandedTask}
          setExpandedTask={setExpandedTask}
        />
      )}

      {activeTab === 'runs' && (
        <RunsTab
          projectId={id}
          initialRuns={project.runs}
          selectedRunId={selectedRunId}
          setSelectedRunId={setSelectedRunId}
        />
      )}

      {activeTab === 'knowledge' && (
        <KnowledgeTab projectId={id} knowledgeEnabled={project.use_knowledge === 1} />
      )}

      {activeTab === 'preview' && (
        <PreviewTab instance={instance} projectId={id} startInstance={startInstance} stopInstance={stopInstance} />
      )}
    </div>
  );
}

function TasksTab({
  projectId,
  tasks,
  showTaskForm,
  setShowTaskForm,
  expandedTask,
  setExpandedTask,
}: {
  projectId: string;
  tasks: any[];
  showTaskForm: boolean;
  setShowTaskForm: (show: boolean) => void;
  expandedTask: string | null;
  setExpandedTask: (id: string | null) => void;
}) {
  const createTask = useCreateTask();
  const deleteTask = useDeleteTask();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState(100);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !description) return;

    await createTask.mutateAsync({
      project_id: projectId,
      title,
      description,
      priority,
    });

    setTitle('');
    setDescription('');
    setPriority(100);
    setShowTaskForm(false);
  };

  const statusConfig = {
    pending: { icon: Clock, color: 'text-muted-foreground', bg: 'bg-muted' },
    in_progress: { icon: Play, color: 'text-blue-400', bg: 'bg-blue-400/10' },
    review: { icon: AlertCircle, color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
    completed: { icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-400/10' },
    failed: { icon: XCircle, color: 'text-destructive', bg: 'bg-destructive/10' },
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Tasks</h2>
        <button
          onClick={() => setShowTaskForm(!showTaskForm)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Inject Task
        </button>
      </div>

      {/* Task Form */}
      {showTaskForm && (
        <form onSubmit={handleSubmit} className="mb-6 p-4 bg-card rounded-lg border border-border">
          <h3 className="font-medium mb-4">Create New Task</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Task title"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                placeholder="Detailed implementation instructions..."
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Priority (higher = runs first)
              </label>
              <input
                type="number"
                value={priority}
                onChange={(e) => setPriority(parseInt(e.target.value, 10))}
                className="w-32 px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
                min={0}
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={createTask.isPending}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                {createTask.isPending ? 'Creating...' : 'Create Task'}
              </button>
              <button
                type="button"
                onClick={() => setShowTaskForm(false)}
                className="px-4 py-2 text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Task List */}
      {tasks.length === 0 ? (
        <div className="text-muted-foreground text-center py-8">
          No tasks yet. Inject a task or run the orchestrator to generate one.
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => {
            const config = statusConfig[task.status as keyof typeof statusConfig];
            const StatusIcon = config.icon;
            const isExpanded = expandedTask === task.id;

            return (
              <div
                key={task.id}
                className="bg-card rounded-lg border border-border overflow-hidden"
              >
                <div
                  className="flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/50"
                  onClick={() => setExpandedTask(isExpanded ? null : task.id)}
                >
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  )}
                  <div className={cn('p-1.5 rounded', config.bg)}>
                    <StatusIcon className={cn('w-4 h-4', config.color)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{task.title}</span>
                      {task.is_injected === 1 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-primary/20 text-primary rounded">
                          <Zap className="w-3 h-3" />
                          Injected
                        </span>
                      )}
                      {task.priority > 0 && (
                        <span className="text-xs text-muted-foreground">
                          Priority: {task.priority}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(task.created_at)}
                  </span>
                  {task.status === 'pending' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteTask.mutate({ id: task.id, projectId });
                      }}
                      className="p-1.5 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                {isExpanded && (
                  <div className="px-4 pb-4 pt-0 border-t border-border">
                    <pre className="mt-3 text-sm text-muted-foreground whitespace-pre-wrap font-mono">
                      {task.description}
                    </pre>
                    {task.retry_count > 0 && (
                      <div className="mt-2 text-xs text-muted-foreground">
                        Retries: {task.retry_count}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RunsTab({
  projectId,
  initialRuns,
  selectedRunId,
  setSelectedRunId,
}: {
  projectId: string;
  initialRuns: any[];
  selectedRunId: string | null;
  setSelectedRunId: (id: string | null) => void;
}) {
  const [limit, setLimit] = useState(10);
  const { data: runs, isLoading: runsLoading } = useRuns(projectId, limit);
  const { data: logs, isLoading: logsLoading } = useLogs(selectedRunId || '');

  // Use fetched runs or fall back to initial
  const displayRuns = runs || initialRuns;
  const hasMore = displayRuns.length === limit;

  const statusConfig = {
    running: { color: 'text-blue-400', bg: 'bg-blue-400' },
    completed: { color: 'text-green-400', bg: 'bg-green-400' },
    failed: { color: 'text-destructive', bg: 'bg-destructive' },
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {/* Run List */}
      <div className="w-full lg:w-80 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Runs</h2>
          <span className="text-xs text-muted-foreground">
            Showing {displayRuns.length}
          </span>
        </div>
        {displayRuns.length === 0 ? (
          <div className="text-muted-foreground text-center py-8">
            No runs yet. Use the CLI to run the orchestrator.
          </div>
        ) : (
          <>
            <div className="flex lg:flex-col gap-2 overflow-x-auto pb-2 lg:pb-0 lg:max-h-[60vh] lg:overflow-y-auto">
              {displayRuns.map((run) => {
                const config = statusConfig[run.status as keyof typeof statusConfig];
                return (
                  <button
                    key={run.id}
                    onClick={() => setSelectedRunId(run.id === selectedRunId ? null : run.id)}
                    className={cn(
                      'min-w-[200px] lg:min-w-0 w-full text-left p-3 rounded-lg border transition-colors flex-shrink-0 lg:flex-shrink',
                      selectedRunId === run.id
                        ? 'bg-primary/10 border-primary'
                        : 'bg-card border-border hover:border-muted-foreground'
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={cn(
                          'w-2 h-2 rounded-full',
                          config.bg,
                          run.status === 'running' && 'animate-pulse'
                        )}
                      />
                      <span className="text-sm font-medium capitalize">{run.status}</span>
                      {run.git_commit_sha && (
                        <span className="text-xs text-muted-foreground font-mono">
                          {run.git_commit_sha.slice(0, 7)}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(run.started_at)}
                      {run.finished_at && (
                        <span className="ml-2">
                          ({formatDuration(run.started_at, run.finished_at)})
                        </span>
                      )}
                    </div>
                    {run.summary && (
                      <div className="text-xs text-muted-foreground mt-1 truncate">
                        {run.summary}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            {hasMore && (
              <button
                onClick={() => setLimit((prev) => prev + 20)}
                disabled={runsLoading}
                className="w-full mt-3 py-2 text-sm text-primary hover:text-primary/80 disabled:opacity-50"
              >
                {runsLoading ? 'Loading...' : 'Load more runs'}
              </button>
            )}
          </>
        )}
      </div>

      {/* Log Viewer */}
      <div className="flex-1 min-w-0 w-full">
        <h2 className="text-lg font-semibold mb-4">Logs</h2>
        {!selectedRunId ? (
          <div className="text-muted-foreground text-center py-8">
            Select a run to view logs
          </div>
        ) : logsLoading ? (
          <div className="text-muted-foreground">Loading logs...</div>
        ) : !logs || logs.length === 0 ? (
          <div className="text-muted-foreground text-center py-8">No logs for this run</div>
        ) : (
          <div className="space-y-4">
            {logs.map((log) => {
              const agentConfig = {
                planner: { color: 'bg-blue-500', label: 'Planner', icon: '📋' },
                developer: { color: 'bg-green-500', label: 'Developer', icon: '💻' },
                reviewer: { color: 'bg-yellow-500', label: 'Reviewer', icon: '🔍' },
                orchestrator: { color: 'bg-purple-500', label: 'Orchestrator', icon: '🎯' },
              };

              const eventConfig = {
                started: { label: 'Started', color: 'text-blue-400' },
                prompt_sent: { label: 'Prompt Sent', color: 'text-cyan-400' },
                response_received: { label: 'Response Received', color: 'text-green-400' },
                error: { label: 'Error', color: 'text-destructive' },
                completed: { label: 'Completed', color: 'text-green-400' },
              };

              const agent = agentConfig[log.agent as keyof typeof agentConfig] || { color: 'bg-gray-500', label: log.agent, icon: '⚙️' };
              const event = eventConfig[log.event as keyof typeof eventConfig] || { label: log.event, color: 'text-muted-foreground' };

              return (
                <div key={log.id} className="bg-card rounded-lg border border-border overflow-hidden">
                  {/* Header */}
                  <div className="flex flex-wrap items-center gap-2 px-3 py-2 sm:px-4 sm:py-3 bg-muted/30 border-b border-border">
                    <span className={cn('px-2 py-1 rounded text-xs font-semibold text-white', agent.color)}>
                      {agent.icon} {agent.label}
                    </span>
                    <span className={cn('text-xs font-medium', event.color)}>
                      {event.label}
                    </span>
                    <span className="text-xs text-muted-foreground sm:ml-auto">
                      {formatDate(log.timestamp)}
                    </span>
                  </div>

                  {/* Content */}
                  <div className="p-3 sm:p-4 space-y-3 sm:space-y-4">
                    {log.prompt && (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[10px] sm:text-xs font-semibold text-cyan-400 uppercase tracking-wide">
                            → What we asked
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            ({log.prompt.length.toLocaleString()} chars)
                          </span>
                        </div>
                        <pre className="text-[10px] sm:text-xs bg-cyan-950/30 border border-cyan-900/50 text-cyan-100 p-2 sm:p-3 rounded-lg overflow-x-auto max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words">
                          {log.prompt}
                        </pre>
                      </div>
                    )}

                    {log.response && (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[10px] sm:text-xs font-semibold text-green-400 uppercase tracking-wide">
                            ← Agent response
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            ({log.response.length.toLocaleString()} chars)
                          </span>
                        </div>
                        <pre className="text-[10px] sm:text-xs bg-green-950/30 border border-green-900/50 text-green-100 p-2 sm:p-3 rounded-lg overflow-x-auto max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words">
                          {log.response}
                        </pre>
                      </div>
                    )}

                    {!log.prompt && !log.response && (
                      <div className="text-sm text-muted-foreground italic">
                        {log.event === 'started' && `${agent.label} agent started`}
                        {log.event === 'completed' && `${agent.label} agent completed successfully`}
                        {log.event === 'error' && 'An error occurred'}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewTab({
  instance,
  projectId,
  startInstance,
  stopInstance,
}: {
  instance: { status: string; port: number; error?: string } | null | undefined;
  projectId: string;
  startInstance: { mutate: (id: string) => void; isPending: boolean };
  stopInstance: { mutate: (id: string) => void; isPending: boolean };
}) {
  const isRunning = instance?.status === 'running';
  const isStarting = instance?.status === 'starting';
  const isOrphaned = instance?.status === 'orphaned';

  // Custom base URL from localStorage
  const [customBaseUrl, setCustomBaseUrl] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('preview-base-url') || '';
    }
    return '';
  });
  const [showSettings, setShowSettings] = useState(false);

  const saveBaseUrl = (url: string) => {
    setCustomBaseUrl(url);
    if (typeof window !== 'undefined') {
      if (url) {
        localStorage.setItem('preview-base-url', url);
      } else {
        localStorage.removeItem('preview-base-url');
      }
    }
  };

  // Build the preview URL (works for both running and orphaned)
  const hasActiveServer = isRunning || isOrphaned;
  const localUrl = hasActiveServer ? `http://localhost:${instance!.port}` : null;
  const previewUrl = hasActiveServer
    ? customBaseUrl
      ? `${customBaseUrl.replace(/\/$/, '')}:${instance!.port}`
      : localUrl
    : null;

  if (!hasActiveServer && !isStarting) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <Play className="w-8 h-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-2">Start the Dev Server</h3>
        <p className="text-muted-foreground mb-6 max-w-md">
          Start the development server to preview your project.
        </p>
        <button
          onClick={() => startInstance.mutate(projectId)}
          disabled={startInstance.isPending}
          className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
        >
          {startInstance.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4" />
          )}
          Start Dev Server
        </button>
        {instance?.status === 'error' && (
          <p className="mt-4 text-sm text-destructive">{instance.error}</p>
        )}

        {/* Settings for custom URL */}
        <div className="mt-8 w-full max-w-md">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <span>Custom preview URL (for Tailscale/remote access):</span>
          </div>
          <input
            type="text"
            value={customBaseUrl}
            onChange={(e) => saveBaseUrl(e.target.value)}
            placeholder="e.g., http://omarchy.tail0a867a.ts.net"
            className="w-full px-3 py-2 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>
    );
  }

  if (isStarting) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
        <h3 className="text-lg font-semibold mb-2">Starting Dev Server...</h3>
        <p className="text-muted-foreground">
          Please wait while the development server starts up.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Orphaned warning banner */}
      {isOrphaned && (
        <div className="flex items-center gap-3 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-sm">
          <AlertCircle className="w-4 h-4 text-yellow-500 flex-shrink-0" />
          <div className="flex-1">
            <span className="text-yellow-400 font-medium">Orphaned process detected</span>
            <span className="text-muted-foreground ml-2">
              A server from a previous session is still running on port {instance!.port}.
            </span>
          </div>
        </div>
      )}

      {/* Controls row - stacks on mobile */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm min-w-0">
          <span className={cn(
            "w-2 h-2 rounded-full flex-shrink-0",
            isOrphaned ? "bg-yellow-400" : "bg-green-400 animate-pulse"
          )} />
          <span className="text-muted-foreground flex-shrink-0">
            Port {instance!.port}
            {isOrphaned && <span className="text-yellow-400 ml-1">(orphaned)</span>}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <a
            href={previewUrl!}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90"
          >
            <ExternalLink className="w-3 h-3" />
            Open
          </a>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={cn(
              "inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded",
              showSettings ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            <AlertCircle className="w-3 h-3" />
            URL
          </button>
          <button
            onClick={() => stopInstance.mutate(projectId)}
            disabled={stopInstance.isPending}
            className="inline-flex items-center gap-1.5 px-2 py-1 text-xs bg-destructive text-destructive-foreground rounded hover:bg-destructive/90 disabled:opacity-50"
          >
            <Square className="w-3 h-3" />
            {isOrphaned ? 'Kill' : 'Stop'}
          </button>
          {isOrphaned && (
            <button
              onClick={() => {
                stopInstance.mutate(projectId);
                // Start after a short delay to let the kill complete
                setTimeout(() => startInstance.mutate(projectId), 1000);
              }}
              disabled={stopInstance.isPending || startInstance.isPending}
              className="inline-flex items-center gap-1.5 px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            >
              <Play className="w-3 h-3" />
              Restart
            </button>
          )}
        </div>
      </div>

      {/* Custom URL settings */}
      {showSettings && (
        <div className="p-3 bg-muted/50 rounded-lg border border-border">
          <label className="block text-xs text-muted-foreground mb-1">
            Custom base URL (for Tailscale/remote access):
          </label>
          <input
            type="text"
            value={customBaseUrl}
            onChange={(e) => saveBaseUrl(e.target.value)}
            placeholder="e.g., http://omarchy.tail0a867a.ts.net"
            className="w-full px-2 py-1 text-sm bg-input border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Preview: {previewUrl}
          </p>
        </div>
      )}

      {/* iframe preview */}
      <div className="border border-border rounded-lg overflow-hidden bg-white">
        <iframe
          src={previewUrl!}
          className="w-full h-[70vh]"
          title="Project Preview"
        />
      </div>
    </div>
  );
}

function KnowledgeTab({ projectId, knowledgeEnabled }: { projectId: string; knowledgeEnabled: boolean }) {
  const { data: knowledge, isLoading } = useKnowledge(projectId);
  const createKnowledge = useCreateKnowledge();
  const updateKnowledge = useUpdateKnowledge();
  const deleteKnowledge = useDeleteKnowledge();
  const toggleKnowledge = useToggleKnowledge();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    category: 'pattern' as KnowledgeCategory,
    tags: '',
    content: '',
    file_path: '',
    importance: 5,
  });

  const categoryConfig: Record<KnowledgeCategory, { icon: typeof Lightbulb; label: string; color: string; bg: string }> = {
    pattern: { icon: FileText, label: 'Pattern', color: 'text-blue-400', bg: 'bg-blue-400/10' },
    gotcha: { icon: AlertCircle, label: 'Gotcha', color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
    decision: { icon: CheckCircle, label: 'Decision', color: 'text-green-400', bg: 'bg-green-400/10' },
    preference: { icon: Lightbulb, label: 'Preference', color: 'text-purple-400', bg: 'bg-purple-400/10' },
    file_note: { icon: FileText, label: 'File Note', color: 'text-cyan-400', bg: 'bg-cyan-400/10' },
  };

  const resetForm = () => {
    setFormData({
      category: 'pattern',
      tags: '',
      content: '',
      file_path: '',
      importance: 5,
    });
    setEditingId(null);
    setShowForm(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.content.trim()) return;

    const tags = formData.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    if (editingId) {
      await updateKnowledge.mutateAsync({
        id: editingId,
        category: formData.category,
        tags,
        content: formData.content,
        file_path: formData.file_path || null,
        importance: formData.importance,
      });
    } else {
      await createKnowledge.mutateAsync({
        project_id: projectId,
        category: formData.category,
        tags,
        content: formData.content,
        file_path: formData.file_path || undefined,
        importance: formData.importance,
      });
    }

    resetForm();
  };

  const startEdit = (entry: NonNullable<typeof knowledge>[0]) => {
    const tags = JSON.parse(entry.tags) as string[];
    setFormData({
      category: entry.category as KnowledgeCategory,
      tags: tags.join(', '),
      content: entry.content,
      file_path: entry.file_path || '',
      importance: entry.importance,
    });
    setEditingId(entry.id);
    setShowForm(true);
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 bg-card border border-border rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col gap-4 mb-4">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-lg font-semibold">Project Knowledge Base</h2>
            <p className="text-sm text-muted-foreground">
              Learnings and patterns that help agents understand this project
            </p>
          </div>
          <button
            onClick={() => {
              resetForm();
              setShowForm(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Knowledge
          </button>
        </div>

        {/* Knowledge Toggle */}
        <div className="flex items-center justify-between p-3 bg-card rounded-lg border border-border">
          <div className="flex items-center gap-3">
            {knowledgeEnabled ? (
              <ToggleRight className="w-5 h-5 text-green-400" />
            ) : (
              <ToggleLeft className="w-5 h-5 text-muted-foreground" />
            )}
            <div>
              <span className="text-sm font-medium">
                Knowledge Injection: {knowledgeEnabled ? 'Enabled' : 'Disabled'}
              </span>
              <p className="text-xs text-muted-foreground">
                {knowledgeEnabled
                  ? 'Agents will use knowledge entries to inform their work'
                  : 'Agents will ignore all knowledge entries'}
              </p>
            </div>
          </div>
          <button
            onClick={() => toggleKnowledge.mutate({ projectId, enabled: !knowledgeEnabled })}
            disabled={toggleKnowledge.isPending}
            className={cn(
              'px-3 py-1.5 text-sm rounded-lg transition-colors',
              knowledgeEnabled
                ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}
          >
            {toggleKnowledge.isPending ? 'Updating...' : knowledgeEnabled ? 'Disable' : 'Enable'}
          </button>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="mb-6 p-4 bg-card rounded-lg border border-border">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-medium">{editingId ? 'Edit Entry' : 'Add New Entry'}</h3>
            <button type="button" onClick={resetForm} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-1">Category</label>
              <select
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value as KnowledgeCategory })}
                className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="pattern">Pattern - Code patterns & examples</option>
                <option value="gotcha">Gotcha - Common pitfalls to avoid</option>
                <option value="decision">Decision - Architectural decisions</option>
                <option value="preference">Preference - User preferences</option>
                <option value="file_note">File Note - Notes about specific files</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Importance (1-10)
              </label>
              <input
                type="range"
                min={1}
                max={10}
                value={formData.importance}
                onChange={(e) => setFormData({ ...formData, importance: parseInt(e.target.value) })}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Low</span>
                <span className="font-medium">{formData.importance}</span>
                <span>Critical</span>
              </div>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Content</label>
            <textarea
              value={formData.content}
              onChange={(e) => setFormData({ ...formData, content: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              placeholder="Describe the pattern, gotcha, or decision..."
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-1">Tags (comma-separated)</label>
              <input
                type="text"
                value={formData.tags}
                onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="auth, api, database"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Related File (optional)</label>
              <input
                type="text"
                value={formData.file_path}
                onChange={(e) => setFormData({ ...formData, file_path: e.target.value })}
                className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="src/lib/auth.ts"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={createKnowledge.isPending || updateKnowledge.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {editingId ? 'Update' : 'Save'}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="px-4 py-2 text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Knowledge List */}
      {!knowledge || knowledge.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <BookOpen className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p className="mb-2">No knowledge entries yet</p>
          <p className="text-sm">
            Add patterns, gotchas, and decisions to help agents understand this project better.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {knowledge.map((entry) => {
            const config = categoryConfig[entry.category as KnowledgeCategory];
            const Icon = config?.icon || FileText;
            const tags = JSON.parse(entry.tags) as string[];

            return (
              <div
                key={entry.id}
                className="bg-card rounded-lg border border-border p-4 hover:border-muted-foreground/50 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className={cn('p-2 rounded', config?.bg || 'bg-muted')}>
                    <Icon className={cn('w-4 h-4', config?.color || 'text-muted-foreground')} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={cn('text-xs font-medium', config?.color || 'text-muted-foreground')}>
                        {config?.label || entry.category}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Importance: {entry.importance}/10
                      </span>
                      {entry.file_path && (
                        <span className="text-xs text-cyan-400 font-mono">
                          {entry.file_path}
                        </span>
                      )}
                    </div>

                    <p className="text-sm mb-2">{entry.content}</p>

                    {tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {tags.map((tag, i) => (
                          <span
                            key={i}
                            className="px-2 py-0.5 text-xs bg-muted rounded text-muted-foreground"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => startEdit(entry)}
                      className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => deleteKnowledge.mutate({ id: entry.id, projectId })}
                      className="p-1.5 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

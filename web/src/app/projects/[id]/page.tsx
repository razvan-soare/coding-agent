'use client';

import { useState, use } from 'react';
import Link from 'next/link';
import { useProject } from '@/lib/hooks/useProjects';
import { useCreateTask, useDeleteTask } from '@/lib/hooks/useTasks';
import { useLogs } from '@/lib/hooks/useRuns';
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
} from 'lucide-react';

type Tab = 'tasks' | 'runs';

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: project, isLoading, error } = useProject(id);
  const [activeTab, setActiveTab] = useState<Tab>('tasks');
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="text-muted-foreground">Loading project...</div>
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
        <h1 className="text-2xl font-bold">{project.name}</h1>
        <p className="text-muted-foreground text-sm">{project.path}</p>
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
          runs={project.runs}
          selectedRunId={selectedRunId}
          setSelectedRunId={setSelectedRunId}
        />
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
  runs,
  selectedRunId,
  setSelectedRunId,
}: {
  runs: any[];
  selectedRunId: string | null;
  setSelectedRunId: (id: string | null) => void;
}) {
  const { data: logs, isLoading: logsLoading } = useLogs(selectedRunId || '');

  const statusConfig = {
    running: { color: 'text-blue-400', bg: 'bg-blue-400' },
    completed: { color: 'text-green-400', bg: 'bg-green-400' },
    failed: { color: 'text-destructive', bg: 'bg-destructive' },
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {/* Run List */}
      <div className="w-full lg:w-80 flex-shrink-0">
        <h2 className="text-lg font-semibold mb-4">Recent Runs</h2>
        {runs.length === 0 ? (
          <div className="text-muted-foreground text-center py-8">
            No runs yet. Use the CLI to run the orchestrator.
          </div>
        ) : (
          <div className="flex lg:flex-col gap-2 overflow-x-auto pb-2 lg:pb-0">
            {runs.map((run) => {
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
                        </div>
                        <pre className="text-[10px] sm:text-xs bg-cyan-950/30 border border-cyan-900/50 text-cyan-100 p-2 sm:p-3 rounded-lg overflow-x-auto max-h-48 sm:max-h-60 overflow-y-auto whitespace-pre-wrap break-words">
                          {log.prompt.slice(0, 2000)}
                          {log.prompt.length > 2000 && '\n\n... (truncated)'}
                        </pre>
                      </div>
                    )}

                    {log.response && (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[10px] sm:text-xs font-semibold text-green-400 uppercase tracking-wide">
                            ← Agent response
                          </span>
                        </div>
                        <pre className="text-[10px] sm:text-xs bg-green-950/30 border border-green-900/50 text-green-100 p-2 sm:p-3 rounded-lg overflow-x-auto max-h-48 sm:max-h-60 overflow-y-auto whitespace-pre-wrap break-words">
                          {log.response.slice(0, 3000)}
                          {log.response.length > 3000 && '\n\n... (truncated)'}
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

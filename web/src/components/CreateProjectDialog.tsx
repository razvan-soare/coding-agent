'use client';

import { useState, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  X,
  Plus,
  Loader2,
  Sparkles,
  CheckCircle,
  FolderPlus,
  Github,
  Folder,
  AlertCircle,
  Download,
  BookOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface CreateProjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

interface SuggestedMilestone {
  title: string;
  description: string;
}

type CreationMode = 'new' | 'import';
type ImportMode = 'in_place' | 'reference';

interface SourceValidation {
  valid: boolean;
  type: 'github' | 'local' | null;
  error?: string;
  suggestedName?: string;
}

export default function CreateProjectDialog({ isOpen, onClose }: CreateProjectDialogProps) {
  const queryClient = useQueryClient();

  // Creation mode state
  const [creationMode, setCreationMode] = useState<CreationMode>('new');

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [useKnowledge, setUseKnowledge] = useState(false);
  const [cronEnabled, setCronEnabled] = useState(false);
  const [cronSchedule, setCronSchedule] = useState('0 */3 * * *');

  // Import-specific state
  const [importMode, setImportMode] = useState<ImportMode>('reference');
  const [repositorySource, setRepositorySource] = useState('');
  const [sourceValidation, setSourceValidation] = useState<SourceValidation | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  // AI planning state
  const [apiKey, setApiKey] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('openai-api-key') || '' : ''
  );
  const [isPlanning, setIsPlanning] = useState(false);
  const [plannerResponse, setPlannerResponse] = useState('');
  const [suggestedMilestones, setSuggestedMilestones] = useState<SuggestedMilestone[]>([]);
  const [approvedMilestones, setApprovedMilestones] = useState<SuggestedMilestone[]>([]);

  // Creation state
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  // Validate repository source
  const validateSource = useCallback(async (source: string) => {
    if (!source.trim()) {
      setSourceValidation(null);
      return;
    }

    setIsValidating(true);
    try {
      const response = await fetch('/api/projects/validate-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: source.trim() }),
      });
      const result = await response.json();
      setSourceValidation(result);

      // Auto-fill name from suggested name if name is empty
      if (result.valid && result.suggestedName && !name) {
        setName(result.suggestedName);
      }
    } catch {
      setSourceValidation({ valid: false, type: null, error: 'Failed to validate source' });
    } finally {
      setIsValidating(false);
    }
  }, [name]);

  // Debounced validation on source change
  useEffect(() => {
    if (creationMode !== 'import') return;

    const timer = setTimeout(() => {
      validateSource(repositorySource);
    }, 500);

    return () => clearTimeout(timer);
  }, [repositorySource, creationMode, validateSource]);

  const resetForm = () => {
    setCreationMode('new');
    setName('');
    setDescription('');
    setUseKnowledge(false);
    setCronEnabled(false);
    setCronSchedule('0 */3 * * *');
    setImportMode('reference');
    setRepositorySource('');
    setSourceValidation(null);
    setPlannerResponse('');
    setSuggestedMilestones([]);
    setApprovedMilestones([]);
    setError('');
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleGenerateMilestones = async () => {
    if (!description.trim() || !apiKey.trim()) return;

    setIsPlanning(true);
    setPlannerResponse('');
    setSuggestedMilestones([]);
    setError('');

    try {
      const response = await fetch('/api/milestones/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ featureIdea: description, openaiApiKey: apiKey }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate plan');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;

            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                fullResponse += parsed.content;
                setPlannerResponse(fullResponse);
              }
            } catch {
              // Skip non-JSON lines
            }
          }
        }
      }

      // Parse completed response
      try {
        const result = JSON.parse(fullResponse);
        if (result.milestones && Array.isArray(result.milestones)) {
          setSuggestedMilestones(result.milestones);
        }
      } catch {
        console.error('Failed to parse milestones from response');
      }
    } catch (err) {
      console.error('Planning failed:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsPlanning(false);
    }
  };

  const handleApproveMilestone = (milestone: SuggestedMilestone) => {
    setApprovedMilestones((prev) => [...prev, milestone]);
    setSuggestedMilestones((prev) => prev.filter((m) => m.title !== milestone.title));
  };

  const handleApproveAll = () => {
    setApprovedMilestones((prev) => [...prev, ...suggestedMilestones]);
    setSuggestedMilestones([]);
  };

  const handleRemoveApproved = (title: string) => {
    setApprovedMilestones((prev) => prev.filter((m) => m.title !== title));
  };

  const handleCreateProject = async () => {
    if (!name.trim()) {
      setError('Project name is required');
      return;
    }

    if (creationMode === 'import') {
      if (!repositorySource.trim()) {
        setError('Repository source is required');
        return;
      }
      if (!sourceValidation?.valid) {
        setError('Please enter a valid repository source');
        return;
      }
      if (!description.trim()) {
        setError('Description is required for imports - explain what you want to achieve');
        return;
      }
    }

    setIsCreating(true);
    setError('');

    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim() || 'A new project',
        milestones: approvedMilestones,
        use_knowledge: useKnowledge ? 1 : 0,
        cron_enabled: cronEnabled ? 1 : 0,
        cron_schedule: cronSchedule,
      };

      if (creationMode === 'import') {
        payload.creation_mode = 'import';
        payload.import_mode = importMode;
        payload.repository_source = repositorySource.trim();
      }

      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create project');
      }

      // Invalidate projects cache to refresh the list
      queryClient.invalidateQueries({ queryKey: ['projects'] });

      handleClose();
    } catch (err) {
      console.error('Failed to create project:', err);
      setError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setIsCreating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Dialog */}
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-4 bg-card rounded-lg border border-border shadow-xl">
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between p-4 border-b border-border bg-card z-10">
          <div className="flex items-center gap-2">
            <FolderPlus className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">
              {creationMode === 'new' ? 'Create New Project' : 'Import Repository'}
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-6">
          {/* Creation Mode Toggle */}
          <div className="flex gap-2 p-1 bg-muted rounded-lg">
            <button
              onClick={() => setCreationMode('new')}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm rounded-md transition-colors',
                creationMode === 'new'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Plus className="w-4 h-4" />
              Create New
            </button>
            <button
              onClick={() => setCreationMode('import')}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm rounded-md transition-colors',
                creationMode === 'import'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Download className="w-4 h-4" />
              Import Repository
            </button>
          </div>

          {/* Import Mode Section */}
          {creationMode === 'import' && (
            <>
              {/* Repository Source */}
              <div>
                <label className="block text-sm font-medium mb-1">Repository Source *</label>
                <div className="relative">
                  <input
                    type="text"
                    value={repositorySource}
                    onChange={(e) => setRepositorySource(e.target.value)}
                    className={cn(
                      'w-full px-3 py-2 pr-10 bg-input border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring',
                      sourceValidation?.valid
                        ? 'border-green-500'
                        : sourceValidation?.error
                        ? 'border-destructive'
                        : 'border-border'
                    )}
                    placeholder="https://github.com/user/repo or /path/to/local/repo"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    {isValidating ? (
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    ) : sourceValidation?.valid ? (
                      sourceValidation.type === 'github' ? (
                        <Github className="w-4 h-4 text-green-500" />
                      ) : (
                        <Folder className="w-4 h-4 text-green-500" />
                      )
                    ) : sourceValidation?.error ? (
                      <AlertCircle className="w-4 h-4 text-destructive" />
                    ) : null}
                  </div>
                </div>
                {sourceValidation?.error && (
                  <p className="mt-1 text-xs text-destructive">{sourceValidation.error}</p>
                )}
                {sourceValidation?.valid && (
                  <p className="mt-1 text-xs text-green-500">
                    {sourceValidation.type === 'github' ? 'GitHub repository' : 'Local repository'} detected
                  </p>
                )}
              </div>

              {/* Import Mode Selection */}
              <div>
                <label className="block text-sm font-medium mb-2">Import Mode *</label>
                <div className="space-y-2">
                  <label
                    className={cn(
                      'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                      importMode === 'in_place'
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-muted-foreground'
                    )}
                  >
                    <input
                      type="radio"
                      name="importMode"
                      checked={importMode === 'in_place'}
                      onChange={() => setImportMode('in_place')}
                      className="mt-1"
                    />
                    <div>
                      <span className="text-sm font-medium">Work in Place</span>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Agents will work directly on the repository, updating and modernizing the existing code.
                      </p>
                    </div>
                  </label>

                  <label
                    className={cn(
                      'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                      importMode === 'reference'
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-muted-foreground'
                    )}
                  >
                    <input
                      type="radio"
                      name="importMode"
                      checked={importMode === 'reference'}
                      onChange={() => setImportMode('reference')}
                      className="mt-1"
                    />
                    <div>
                      <span className="text-sm font-medium flex items-center gap-1">
                        Use as Reference
                        <BookOpen className="w-3 h-3" />
                      </span>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Create a new project. Agents can read the reference repo for patterns and structure but build fresh.
                      </p>
                    </div>
                  </label>
                </div>
              </div>
            </>
          )}

          {/* Project Name */}
          <div>
            <label className="block text-sm font-medium mb-1">Project Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="my-awesome-project"
            />
          </div>

          {/* Project Description */}
          <div>
            <label className="block text-sm font-medium mb-1">
              {creationMode === 'import' ? (
                <>What do you want to achieve? *</>
              ) : (
                <>
                  Project Description
                  <span className="text-muted-foreground font-normal ml-1">(used for AI milestone generation)</span>
                </>
              )}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={creationMode === 'import' ? 4 : 3}
              className="w-full px-3 py-2 bg-input border border-border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder={
                creationMode === 'import'
                  ? importMode === 'in_place'
                    ? 'Describe what you want to do with this repository. E.g., "Modernize the codebase to use React 18 and TypeScript, update dependencies, add tests..."'
                    : 'Describe what you want to build using this reference. E.g., "Build a similar app but with a different design, keep the animation logic..."'
                  : 'Describe what you want to build...'
              }
            />
            {creationMode === 'import' && (
              <p className="mt-1 text-xs text-muted-foreground">
                Be specific about your goals and how you want to use the existing code.
              </p>
            )}
          </div>

          {/* AI Milestone Generation - only for new projects */}
          {creationMode === 'new' && (
            <div className="p-4 bg-muted/30 rounded-lg border border-border">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-purple-400" />
                <span className="text-sm font-medium">AI Milestone Generation</span>
              </div>

              <div className="mb-3">
                <label className="block text-xs text-muted-foreground mb-1">OpenAI API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    if (typeof window !== 'undefined') {
                      localStorage.setItem('openai-api-key', e.target.value);
                    }
                  }}
                  placeholder="sk-..."
                  className="w-full px-3 py-2 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <button
                onClick={handleGenerateMilestones}
                disabled={!description.trim() || !apiKey.trim() || isPlanning}
                className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPlanning ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Generating...
                  </span>
                ) : (
                  'Generate Milestones from Description'
                )}
              </button>

              {/* Streaming response */}
              {plannerResponse && suggestedMilestones.length === 0 && (
                <div className="mt-3 p-2 bg-muted/50 rounded text-xs font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
                  {plannerResponse}
                </div>
              )}

              {/* Suggested milestones */}
              {suggestedMilestones.length > 0 && (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      Suggested ({suggestedMilestones.length})
                    </span>
                    <button
                      onClick={handleApproveAll}
                      className="text-xs text-green-400 hover:text-green-300"
                    >
                      Approve All
                    </button>
                  </div>
                  {suggestedMilestones.map((m, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 p-2 bg-muted rounded text-sm"
                    >
                      <div className="flex-1">
                        <div className="font-medium">{m.title}</div>
                        {m.description && (
                          <div className="text-xs text-muted-foreground">{m.description}</div>
                        )}
                      </div>
                      <button
                        onClick={() => handleApproveMilestone(m)}
                        className="p-1 text-green-400 hover:text-green-300"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Note for imports */}
          {creationMode === 'import' && (
            <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg text-sm">
              <p className="text-blue-400">
                Milestones can be added after project creation using the AI Planner on the project page.
              </p>
            </div>
          )}

          {/* Approved Milestones */}
          {approvedMilestones.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-2">
                Milestones to Create ({approvedMilestones.length})
              </label>
              <div className="space-y-2">
                {approvedMilestones.map((m, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 p-2 bg-green-500/10 border border-green-500/30 rounded text-sm"
                  >
                    <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <div className="font-medium">{m.title}</div>
                      {m.description && (
                        <div className="text-xs text-muted-foreground">{m.description}</div>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemoveApproved(m.title)}
                      className="p-1 text-muted-foreground hover:text-destructive"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Project Settings */}
          <div className="space-y-3">
            <span className="text-sm font-medium">Project Settings</span>

            {/* Use Knowledge Toggle */}
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={useKnowledge}
                onChange={(e) => setUseKnowledge(e.target.checked)}
                className="w-4 h-4 rounded border-border"
              />
              <div>
                <span className="text-sm">Use Knowledge Base</span>
                <p className="text-xs text-muted-foreground">
                  Allow agents to learn from and use project-specific knowledge
                </p>
              </div>
            </label>

            {/* Auto-start (Cron) Toggle */}
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={cronEnabled}
                onChange={(e) => setCronEnabled(e.target.checked)}
                className="w-4 h-4 rounded border-border"
              />
              <div>
                <span className="text-sm">Start Automatically (Cron)</span>
                <p className="text-xs text-muted-foreground">
                  Automatically run the agent on a schedule
                </p>
              </div>
            </label>

            {/* Cron Schedule */}
            {cronEnabled && (
              <div className="ml-7">
                <label className="block text-xs text-muted-foreground mb-1">Schedule</label>
                <select
                  value={cronSchedule}
                  onChange={(e) => setCronSchedule(e.target.value)}
                  className="px-2 py-1.5 text-sm bg-input border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="*/5 * * * *">Every 5 minutes</option>
                  <option value="*/15 * * * *">Every 15 minutes</option>
                  <option value="*/30 * * * *">Every 30 minutes</option>
                  <option value="0 * * * *">Every hour</option>
                  <option value="0 */3 * * *">Every 3 hours</option>
                  <option value="0 */6 * * *">Every 6 hours</option>
                  <option value="0 */12 * * *">Every 12 hours</option>
                </select>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/30 rounded text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 flex items-center justify-end gap-2 p-4 border-t border-border bg-card">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={handleCreateProject}
            disabled={
              !name.trim() ||
              isCreating ||
              (creationMode === 'import' && (!sourceValidation?.valid || !description.trim()))
            }
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-colors',
              'bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {isCreating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {creationMode === 'import' ? 'Importing...' : 'Creating...'}
              </>
            ) : (
              <>
                {creationMode === 'import' ? (
                  <Download className="w-4 h-4" />
                ) : (
                  <FolderPlus className="w-4 h-4" />
                )}
                {creationMode === 'import' ? 'Import Project' : 'Create Project'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

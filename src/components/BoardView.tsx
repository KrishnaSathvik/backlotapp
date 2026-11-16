'use client';

import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import {
  getPlatformLabel,
  groupItemsByStatus,
  nextWorkflowStatus,
  prevWorkflowStatus,
  STATUS_OPTIONS,
  type ContentItem,
  type StatusKey,
} from '@/src/lib/content-logic';
import { MediaImage } from './MediaImage';

interface BoardViewProps {
  items: ContentItem[];
  onSelectItem: (item: ContentItem) => void;
  onChangeStatus: (itemId: number, nextStatus: StatusKey) => Promise<void>;
  onCreateNew: () => void;
}

const STAGE_HINTS: Record<StatusKey, string> = {
  idea: 'Planned topics',
  scripting: 'Hooks & script',
  editing: 'Cutting media',
  ready: 'Ready to post',
  posted: 'Live & saved',
};

export const BoardView: React.FC<BoardViewProps> = ({
  items,
  onSelectItem,
  onChangeStatus,
  onCreateNew,
}) => {
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<StatusKey | null>(null);

  const grouped = groupItemsByStatus(items);

  const handleDrop = async (targetStatus: StatusKey) => {
    setDragOverStatus(null);
    if (draggingId === null) return;
    const dragged = items.find((i) => i.id === draggingId);
    setDraggingId(null);
    if (!dragged || dragged.status === targetStatus) return;
    await onChangeStatus(dragged.id, targetStatus);
  };

  return (
    <section aria-label="Production Tracker" className="space-y-5">
      {items.length === 0 ? (
        <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-zinc-200 bg-zinc-50/70 p-5 sm:flex-row sm:items-center dark:border-zinc-800 dark:bg-zinc-900/50">
          <div>
            <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
              How the Production Tracker works
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
              Every post you add in <strong>Library</strong> (or convert from <strong>Ideas</strong>) shows up here under its current stage. Drag cards across columns or tap the arrow buttons as you go from Idea to Posted.
            </p>
          </div>
          <button
            type="button"
            onClick={onCreateNew}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700 whitespace-nowrap shrink-0"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add First Post
          </button>
        </div>
      ) : null}

      <div
        data-testid="board-columns"
        className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5"
      >
        {STATUS_OPTIONS.map((column) => {
          const columnItems = grouped[column.key] ?? [];
          const isOver = dragOverStatus === column.key;

          return (
            <div
              key={column.key}
              data-status-column={column.key}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverStatus(column.key);
              }}
              onDragLeave={() =>
                setDragOverStatus((prev) => (prev === column.key ? null : prev))
              }
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(column.key);
              }}
              className={`flex min-h-[260px] flex-col rounded-xl border p-3 transition-colors ${
                isOver
                  ? 'border-blue-600 bg-blue-50/40 dark:border-blue-500 dark:bg-blue-950/20'
                  : 'border-zinc-200 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/60'
              }`}
            >
              <div className="mb-3 flex items-start justify-between gap-2 px-1">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                    {column.label}
                  </h3>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    {STAGE_HINTS[column.key]}
                  </p>
                </div>
                <span className="font-mono text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
                  {columnItems.length}
                </span>
              </div>

              <div className="flex flex-1 flex-col gap-2.5">
                {columnItems.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-200 px-3 py-6 text-center text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
                    No posts in {column.label}
                  </div>
                ) : (
                  columnItems.map((item) => {
                    const thumb = item.coverAsset?.url || item.slides[0]?.url;
                    const prev = prevWorkflowStatus(item.status);
                    const next = nextWorkflowStatus(item.status);

                    return (
                      <article
                        key={item.id}
                        draggable
                        onDragStart={() => setDraggingId(item.id)}
                        onDragEnd={() => {
                          setDraggingId(null);
                          setDragOverStatus(null);
                        }}
                        className="cursor-grab rounded-lg border border-zinc-200 bg-white p-3 transition-colors hover:border-zinc-400 active:cursor-grabbing dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
                      >
                        {thumb ? (
                          <button
                            type="button"
                            onClick={() => onSelectItem(item)}
                            aria-label={`Open ${item.title}`}
                            className="mb-2.5 block aspect-video w-full overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-900"
                          >
                            <MediaImage src={thumb} alt={item.title} />
                          </button>
                        ) : null}

                        <div className="text-[11px] font-medium text-blue-600 dark:text-blue-400">
                          {getPlatformLabel(item.platform)}
                          {item.channelName ? ` · ${item.channelName}` : ''}
                        </div>

                        <button
                          type="button"
                          onClick={() => onSelectItem(item)}
                          className="mt-1 block text-left text-sm font-semibold leading-snug text-zinc-950 hover:text-blue-600 dark:text-zinc-50 dark:hover:text-blue-400"
                        >
                          {item.title}
                        </button>

                        <div className="mt-2.5 flex items-center justify-between border-t border-zinc-100 pt-2 dark:border-zinc-800">
                          <span className="font-mono text-[11px] text-zinc-400 tabular-nums">
                            {item.targetDate || item.postDate || 'No date'}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={item.status === 'idea'}
                              onClick={() => onChangeStatus(item.id, prev)}
                              aria-label={`Move ${item.title} back to ${prev}`}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-100 disabled:opacity-30 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900"
                            >
                              <ChevronLeft className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={item.status === 'posted'}
                              onClick={() => onChangeStatus(item.id, next)}
                              aria-label={`Advance ${item.title} to ${next}`}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-100 disabled:opacity-30 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900"
                            >
                              <ChevronRight className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};

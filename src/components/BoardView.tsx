'use client';

import React, { useRef, useState } from 'react';
import { ArrowRight, ChevronLeft, Plus } from 'lucide-react';
import {
  getPlatformShortLabel,
  groupItemsByStatus,
  nextWorkflowStatus,
  prevWorkflowStatus,
  STATUS_OPTIONS,
  type ContentItem,
  type StatusKey,
} from '@/src/lib/content-logic';
import { MediaImage } from './MediaImage';
import { buttonStyles, cx, sizes, STAGE_STYLES } from './ui';

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
  posted: 'Live',
};

export const BoardView: React.FC<BoardViewProps> = ({ items, onSelectItem, onChangeStatus, onCreateNew }) => {
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<StatusKey | null>(null);
  const [movingId, setMovingId] = useState<number | null>(null);
  const columnRefs = useRef<Partial<Record<StatusKey, HTMLDivElement | null>>>({});

  const grouped = groupItemsByStatus(items);

  const move = async (item: ContentItem, status: StatusKey) => {
    if (item.status === status) return;
    setMovingId(item.id);
    try {
      await onChangeStatus(item.id, status);
    } finally {
      setMovingId(null);
    }
  };

  const handleDrop = async (targetStatus: StatusKey) => {
    setDragOverStatus(null);
    const dragged = items.find((i) => i.id === draggingId);
    setDraggingId(null);
    if (dragged) await move(dragged, targetStatus);
  };

  const jumpTo = (status: StatusKey) => {
    columnRefs.current[status]?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  };

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-2xl border border-dashed border-zinc-300 px-6 py-16 text-center dark:border-zinc-800">
        <div className="flex gap-1.5" aria-hidden="true">
          {STATUS_OPTIONS.map((s) => (
            <span key={s.key} className={cx('h-2 w-8 rounded-full', STAGE_STYLES[s.key].dot)} />
          ))}
        </div>
        <h2 className="mt-5 text-base font-semibold">Nothing in production yet</h2>
        <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
          Posts you add show up here by stage. Move them along from Idea to Posted.
        </p>
        <button type="button" onClick={onCreateNew} className={cx(buttonStyles.primary, sizes.md, 'mt-5')}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add a post
        </button>
      </div>
    );
  }

  return (
    <section aria-label="Production tracker">
      {/* Stage jump chips (mobile/tablet) */}
      <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 lg:hidden">
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => jumpTo(s.key)}
            className="flex h-9 shrink-0 items-center gap-2 rounded-full border border-zinc-200 bg-white px-3.5 text-[13px] font-semibold text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
          >
            <span className={cx('h-2 w-2 rounded-full', STAGE_STYLES[s.key].dot)} aria-hidden="true" />
            {s.label}
            <span className="text-zinc-400 tabular-nums">{grouped[s.key]?.length ?? 0}</span>
          </button>
        ))}
      </div>

      <div
        data-testid="board-columns"
        className="no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:grid lg:grid-cols-5 lg:overflow-visible lg:px-0"
      >
        {STATUS_OPTIONS.map((column) => {
          const columnItems = grouped[column.key] ?? [];
          const isOver = dragOverStatus === column.key;
          const stage = STAGE_STYLES[column.key];

          return (
            <div
              key={column.key}
              ref={(el) => {
                columnRefs.current[column.key] = el;
              }}
              data-status-column={column.key}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverStatus(column.key);
              }}
              onDragLeave={() => setDragOverStatus((prev) => (prev === column.key ? null : prev))}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(column.key);
              }}
              className={cx(
                'flex w-[85%] max-w-[340px] shrink-0 snap-start flex-col rounded-2xl border p-2.5 transition-colors sm:w-[46%] lg:w-auto lg:max-w-none',
                isOver
                  ? 'border-blue-400 bg-blue-50/60 dark:border-blue-500 dark:bg-blue-950/30'
                  : 'border-zinc-200/80 bg-zinc-100/60 dark:border-zinc-800 dark:bg-zinc-900/40'
              )}
            >
              <div className="flex items-center justify-between gap-2 px-1.5 pb-2.5 pt-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={cx('h-2 w-2 shrink-0 rounded-full', stage.dot)} aria-hidden="true" />
                  <h3 className="text-sm font-semibold">{column.label}</h3>
                  <span className="truncate text-xs text-zinc-400">{STAGE_HINTS[column.key]}</span>
                </div>
                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-zinc-500 tabular-nums dark:bg-zinc-800 dark:text-zinc-400">
                  {columnItems.length}
                </span>
              </div>

              <div className="flex min-h-[120px] flex-1 flex-col gap-2">
                {columnItems.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-zinc-300/80 px-3 py-6 text-center text-xs text-zinc-400 dark:border-zinc-800">
                    Drop posts here
                  </div>
                ) : (
                  columnItems.map((item) => {
                    const thumb = item.coverAsset?.url || item.slides[0]?.url;
                    const prev = prevWorkflowStatus(item.status);
                    const next = nextWorkflowStatus(item.status);
                    const busy = movingId === item.id;

                    return (
                      <article
                        key={item.id}
                        draggable
                        onDragStart={() => setDraggingId(item.id)}
                        onDragEnd={() => {
                          setDraggingId(null);
                          setDragOverStatus(null);
                        }}
                        className={cx(
                          'group relative rounded-xl border border-zinc-200/80 bg-white p-2.5 shadow-xs transition-all hover:shadow-md lg:cursor-grab lg:active:cursor-grabbing dark:border-zinc-800 dark:bg-zinc-900',
                          draggingId === item.id && 'opacity-50',
                          busy && 'opacity-60'
                        )}
                      >
                        <div className="flex gap-3">
                          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800">
                            <MediaImage src={thumb} alt="" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                              {getPlatformShortLabel(item.platform)}
                              {item.channelName ? (
                                <span className="font-medium text-zinc-400"> · {item.channelName}</span>
                              ) : null}
                            </p>
                            <h4 className="mt-0.5 line-clamp-2 text-[13px] font-semibold leading-snug">
                              <button
                                type="button"
                                onClick={() => onSelectItem(item)}
                                className="text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
                              >
                                {item.title}
                              </button>
                            </h4>
                          </div>
                        </div>

                        <div className="relative z-10 mt-2.5 flex items-center justify-between gap-2">
                          <span className="text-[11px] text-zinc-400 tabular-nums">
                            {item.targetDate || item.postDate || ''}
                          </span>
                          <div className="flex items-center gap-1">
                            {item.status !== 'idea' ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => move(item, prev)}
                                aria-label={`Move back to ${STAGE_STYLES[prev].label}`}
                                title={`Back to ${STAGE_STYLES[prev].label}`}
                                className={cx(buttonStyles.ghost, 'h-8 w-8 rounded-lg')}
                              >
                                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                              </button>
                            ) : null}
                            {item.status !== 'posted' ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => move(item, next)}
                                aria-label={`Move to ${STAGE_STYLES[next].label}`}
                                className="inline-flex h-8 items-center gap-1 rounded-lg bg-zinc-100 px-2.5 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-200 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                              >
                                {STAGE_STYLES[next].label}
                                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            ) : null}
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

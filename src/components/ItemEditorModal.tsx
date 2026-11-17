'use client';

import React, { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Film, ImagePlus, Layers, Trash2, UploadCloud, X } from 'lucide-react';
import {
  formatFileSize,
  formatTagsForCopy,
  parseTagsInput,
  PLATFORM_OPTIONS,
  reorderSlides,
  STATUS_OPTIONS,
  type ChannelItem,
  type ContentItem,
  type MediaAsset,
  type PlatformKey,
  type StatusKey,
} from '@/src/lib/content-logic';
import { uploadAssetResumable } from '@/src/lib/upload-client';
import { IMAGE_TYPES, VIDEO_TYPES } from '@/src/lib/upload-limits';
import { FormSelect } from './CustomSelect';
import { MediaImage } from './MediaImage';
import {
  buttonStyles,
  cx,
  inputStyles,
  labelStyles,
  Sheet,
  SheetCloseButton,
  sizes,
  useFeedback,
} from './ui';

type SavePayload = {
  id?: number;
  title: string;
  platform: PlatformKey;
  channelName: string;
  status: StatusKey;
  caption: string;
  tags: string[];
  notes: string;
  liveLink: string;
  postDate: string;
  targetDate: string;
  coverAsset: MediaAsset | null;
  videoAsset: MediaAsset | null;
  slides: MediaAsset[];
};

interface ItemEditorModalProps {
  isOpen: boolean;
  editingItem: ContentItem | null;
  channels: ChannelItem[];
  authToken: string | null;
  onClose: () => void;
  onSave: (payload: SavePayload) => Promise<void>;
}

const IMAGE_ACCEPT = IMAGE_TYPES.join(',');
const VIDEO_ACCEPT = VIDEO_TYPES.join(',');

export const ItemEditorModal: React.FC<ItemEditorModalProps> = ({
  isOpen,
  editingItem,
  channels,
  authToken,
  onClose,
  onSave,
}) => {
  const { confirm } = useFeedback();
  const [title, setTitle] = useState(editingItem?.title ?? '');
  const [platform, setPlatform] = useState<PlatformKey>(editingItem?.platform ?? 'youtube_long');
  const [channelName, setChannelName] = useState(editingItem?.channelName ?? channels[0]?.name ?? '');
  const [status, setStatus] = useState<StatusKey>(editingItem?.status ?? 'idea');
  const [caption, setCaption] = useState(editingItem?.caption ?? '');
  const [tagsRaw, setTagsRaw] = useState(editingItem ? formatTagsForCopy(editingItem.tags) : '');
  const [notes, setNotes] = useState(editingItem?.notes ?? '');
  const [liveLink, setLiveLink] = useState(editingItem?.liveLink ?? '');
  const [postDate, setPostDate] = useState(editingItem?.postDate ?? '');
  const [targetDate, setTargetDate] = useState(editingItem?.targetDate ?? '');
  const [coverAsset, setCoverAsset] = useState<MediaAsset | null>(editingItem?.coverAsset ?? null);
  const [videoAsset, setVideoAsset] = useState<MediaAsset | null>(editingItem?.videoAsset ?? null);
  const [slides, setSlides] = useState<MediaAsset[]>(editingItem?.slides ?? []);

  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [uploadingLabel, setUploadingLabel] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const touch = <T,>(setter: (v: T) => void) => (v: T) => {
    dirty.current = true;
    setter(v);
  };

  const uploading = uploadPercent !== null;

  const runUpload = async (file: File, label: string): Promise<MediaAsset | null> => {
    setError('');
    setUploadingLabel(label);
    setUploadPercent(0);
    try {
      return await uploadAssetResumable({ file, authToken, onProgress: setUploadPercent });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
      return null;
    } finally {
      setUploadPercent(null);
      setUploadingLabel('');
    }
  };

  const handleUploadCover = async (file: File) => {
    const asset = await runUpload(file, `Uploading cover · ${file.name}`);
    if (asset) touch(setCoverAsset)(asset);
  };

  const handleUploadVideo = async (file: File) => {
    const asset = await runUpload(file, `Uploading video · ${formatFileSize(file.size)}`);
    if (asset) touch(setVideoAsset)(asset);
  };

  const handleUploadSlides = async (files: File[]) => {
    const uploaded: MediaAsset[] = [];
    for (let i = 0; i < files.length; i += 1) {
      const asset = await runUpload(files[i], `Uploading slide ${i + 1} of ${files.length}`);
      if (!asset) break;
      uploaded.push({ ...asset, order: slides.length + uploaded.length });
    }
    if (uploaded.length) {
      dirty.current = true;
      setSlides((prev) => [...prev, ...uploaded]);
    }
  };

  const handleDropFiles = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    const videoFile = files.find((f) => f.type.startsWith('video/'));
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    if (videoFile) await handleUploadVideo(videoFile);
    if (imageFiles.length === 1 && !coverAsset && slides.length === 0) await handleUploadCover(imageFiles[0]);
    else if (imageFiles.length > 0) await handleUploadSlides(imageFiles);
  };

  const requestClose = async () => {
    if (uploading) {
      const ok = await confirm({
        title: 'Cancel the upload?',
        body: 'A file is still uploading. Closing now will discard it.',
        confirmLabel: 'Close anyway',
        tone: 'danger',
      });
      if (!ok) return;
    } else if (dirty.current) {
      const ok = await confirm({
        title: 'Discard changes?',
        body: 'You have unsaved changes to this post.',
        confirmLabel: 'Discard',
        tone: 'danger',
      });
      if (!ok) return;
    }
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Add a title to save this post.');
      titleRef.current?.focus();
      return;
    }
    setError('');
    setSaving(true);
    try {
      await onSave({
        id: editingItem?.id,
        title: title.trim(),
        platform,
        channelName,
        status,
        caption,
        tags: parseTagsInput(tagsRaw),
        notes,
        liveLink: liveLink.trim(),
        postDate,
        targetDate,
        coverAsset,
        videoAsset,
        slides,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const fileButton = 'cursor-pointer';

  return (
    <Sheet onClose={requestClose} label={editingItem ? `Edit ${editingItem.title}` : 'New post'} size="lg">
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-5 py-3.5 sm:px-6 sm:py-4 dark:border-zinc-800">
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-tight">{editingItem ? 'Edit post' : 'New post'}</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Only the title is required.</p>
          </div>
          <SheetCloseButton onClick={requestClose} label="Close editor" />
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
          {/* Basics */}
          <div className="space-y-4">
            <div>
              <label htmlFor="editor-title" className={labelStyles}>
                Title
              </label>
              <input
                ref={titleRef}
                id="editor-title"
                value={title}
                onChange={(e) => touch(setTitle)(e.target.value)}
                placeholder="e.g. Minimalist desk camera rig breakdown"
                maxLength={300}
                className={cx(inputStyles, 'h-12 text-base font-medium sm:text-[15px]')}
              />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="col-span-2 sm:col-span-1">
                <label htmlFor="editor-platform" className={labelStyles}>
                  Platform
                </label>
                <FormSelect
                  id="editor-platform"
                  value={platform}
                  onChange={(e) => touch(setPlatform)(e.target.value as PlatformKey)}
                >
                  {PLATFORM_OPTIONS.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </FormSelect>
              </div>
              <div>
                <label htmlFor="editor-channel" className={labelStyles}>
                  Channel
                </label>
                <FormSelect
                  id="editor-channel"
                  value={channelName}
                  onChange={(e) => touch(setChannelName)(e.target.value)}
                >
                  <option value="">No channel</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </FormSelect>
              </div>
              <div>
                <label htmlFor="editor-status" className={labelStyles}>
                  Stage
                </label>
                <FormSelect
                  id="editor-status"
                  value={status}
                  onChange={(e) => touch(setStatus)(e.target.value as StatusKey)}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </FormSelect>
              </div>
            </div>
          </div>

          {/* Media */}
          <fieldset
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDropFiles}
            className={cx(
              'rounded-2xl border-2 border-dashed p-3 transition-colors sm:p-4',
              isDragOver
                ? 'border-electric-500 bg-electric-50/60 dark:bg-electric-950/30'
                : 'border-zinc-200 dark:border-zinc-800'
            )}
          >
            <legend className="px-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300">Media</legend>
            <p className="mb-3 hidden items-center gap-2 text-xs text-zinc-500 sm:flex dark:text-zinc-400">
              <UploadCloud className="h-4 w-4 text-electric-600 dark:text-electric-400" aria-hidden="true" />
              Drop files here, or choose below. Images up to 30 MB, video up to 10 GB.
            </p>

            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {/* Cover */}
              <MediaTile
                label="Cover"
                icon={ImagePlus}
                filled={!!coverAsset}
                onRemove={() => touch(setCoverAsset)(null)}
                preview={coverAsset ? <MediaImage src={coverAsset.url} alt="Cover" /> : null}
                input={
                  <input
                    type="file"
                    accept={IMAGE_ACCEPT}
                    className="sr-only"
                    disabled={uploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) handleUploadCover(f);
                    }}
                  />
                }
              />
              {/* Video */}
              <MediaTile
                label="Video"
                icon={Film}
                filled={!!videoAsset}
                onRemove={() => touch(setVideoAsset)(null)}
                preview={
                  videoAsset ? (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-zinc-900 p-2 text-center text-white">
                      <Film className="h-5 w-5" aria-hidden="true" />
                      <span className="line-clamp-1 text-[11px] font-medium">{videoAsset.name}</span>
                      <span className="text-[11px] text-zinc-400">{formatFileSize(videoAsset.size)}</span>
                    </div>
                  ) : null
                }
                input={
                  <input
                    type="file"
                    accept={VIDEO_ACCEPT}
                    className="sr-only"
                    disabled={uploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) handleUploadVideo(f);
                    }}
                  />
                }
              />
              {/* Slides */}
              <label
                className={cx(
                  fileButton,
                  'flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 text-center text-xs font-semibold text-zinc-600 transition-colors hover:border-electric-300 hover:bg-electric-50/60 hover:text-electric-700 sm:aspect-[4/3] dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-electric-800 dark:hover:bg-electric-950/30',
                  uploading && 'pointer-events-none opacity-50'
                )}
              >
                <Layers className="h-5 w-5" aria-hidden="true" />
                {slides.length ? `${slides.length} slides · add` : 'Slides'}
                <input
                  type="file"
                  accept={IMAGE_ACCEPT}
                  multiple
                  className="sr-only"
                  disabled={uploading}
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = '';
                    if (files.length) handleUploadSlides(files);
                  }}
                />
              </label>
            </div>

            {uploading ? (
              <div className="mt-3 space-y-1.5" aria-live="polite">
                <div className="flex justify-between gap-3 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  <span className="truncate">{uploadingLabel}</span>
                  <span className="tabular-nums">{uploadPercent}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-electric-600 transition-all"
                    style={{ width: `${uploadPercent}%` }}
                  />
                </div>
              </div>
            ) : null}

            {slides.length > 0 ? (
              <ol className="mt-3 space-y-1.5">
                {slides.map((slide, idx) => (
                  <li
                    key={slide.id}
                    className="flex items-center gap-2.5 rounded-xl border border-zinc-200 bg-white p-1.5 pr-1 dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <span className="w-5 text-center text-xs font-semibold text-zinc-400 tabular-nums">{idx + 1}</span>
                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800">
                      <MediaImage src={slide.url} alt="" />
                    </div>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{slide.name}</span>
                    <div className="flex shrink-0 items-center">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => touch(setSlides)(reorderSlides(slides, idx, idx - 1))}
                        aria-label={`Move slide ${idx + 1} up`}
                        className={cx(buttonStyles.ghost, sizes.iconSm, 'rounded-lg')}
                      >
                        <ArrowUp className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === slides.length - 1}
                        onClick={() => touch(setSlides)(reorderSlides(slides, idx, idx + 1))}
                        aria-label={`Move slide ${idx + 1} down`}
                        className={cx(buttonStyles.ghost, sizes.iconSm, 'rounded-lg')}
                      >
                        <ArrowDown className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          touch(setSlides)(
                            slides.filter((_, i) => i !== idx).map((s, order) => ({ ...s, order }))
                          )
                        }
                        aria-label={`Remove slide ${idx + 1}`}
                        className={cx(buttonStyles.dangerGhost, sizes.iconSm, 'rounded-lg')}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            ) : null}
          </fieldset>

          {/* Copy */}
          <div className="space-y-4">
            <div>
              <label htmlFor="editor-caption" className={labelStyles}>
                Caption / description
              </label>
              <textarea
                id="editor-caption"
                rows={4}
                value={caption}
                onChange={(e) => touch(setCaption)(e.target.value)}
                placeholder="Write your YouTube description or Instagram caption…"
                maxLength={20000}
                className={cx(inputStyles, 'py-3 leading-relaxed')}
              />
            </div>
            <div>
              <label htmlFor="editor-tags" className={labelStyles}>
                Tags
              </label>
              <input
                id="editor-tags"
                value={tagsRaw}
                onChange={(e) => touch(setTagsRaw)(e.target.value)}
                placeholder="#filmmaking #desksetup #shorts"
                autoCapitalize="none"
                autoCorrect="off"
                className={cx(inputStyles, 'h-11 font-mono text-[13px]')}
              />
            </div>
          </div>

          {/* Details */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="editor-target-date" className={labelStyles}>
                {status === 'posted' ? 'Post date' : 'Target date'}
              </label>
              <input
                id="editor-target-date"
                type="date"
                value={status === 'posted' ? postDate || targetDate : targetDate}
                onChange={(e) => {
                  if (status === 'posted') touch(setPostDate)(e.target.value);
                  else touch(setTargetDate)(e.target.value);
                }}
                className={cx(inputStyles, 'h-11')}
              />
            </div>
            <div>
              <label htmlFor="editor-live-link" className={labelStyles}>
                Live post link
              </label>
              <input
                id="editor-live-link"
                type="url"
                inputMode="url"
                value={liveLink}
                onChange={(e) => touch(setLiveLink)(e.target.value)}
                placeholder="https://…"
                className={cx(inputStyles, 'h-11')}
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="editor-notes" className={labelStyles}>
                Notes
              </label>
              <textarea
                id="editor-notes"
                rows={2}
                value={notes}
                onChange={(e) => touch(setNotes)(e.target.value)}
                placeholder="Export settings, hook cue, sponsor note…"
                className={cx(inputStyles, 'py-3')}
              />
            </div>
          </div>
        </div>

        <div className="border-t border-zinc-100 bg-white/90 px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur sm:px-6 sm:pb-3 dark:border-zinc-800 dark:bg-zinc-950/90">
          {error ? (
            <p role="alert" className="mb-2.5 text-sm font-medium text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={requestClose} className={cx(buttonStyles.secondary, sizes.md, 'flex-1 sm:flex-none')}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || uploading}
              className={cx(buttonStyles.primary, sizes.md, 'flex-[2] sm:flex-none sm:px-6')}
            >
              {saving ? 'Saving…' : editingItem ? 'Save changes' : 'Create post'}
            </button>
          </div>
        </div>
      </form>
    </Sheet>
  );
};

function MediaTile({
  label,
  icon: Icon,
  filled,
  preview,
  input,
  onRemove,
}: {
  label: string;
  icon: React.ElementType;
  filled: boolean;
  preview: React.ReactNode;
  input: React.ReactNode;
  onRemove: () => void;
}) {
  if (filled) {
    return (
      <div className="group relative aspect-square overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 sm:aspect-[4/3] dark:border-zinc-800 dark:bg-zinc-900">
        {preview}
        <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur">
          {label}
        </span>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label.toLowerCase()}`}
          className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur hover:bg-black/80"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    );
  }
  return (
    <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 text-center text-xs font-semibold text-zinc-600 transition-colors hover:border-electric-300 hover:bg-electric-50/60 hover:text-electric-700 has-[:disabled]:pointer-events-none has-[:disabled]:opacity-50 sm:aspect-[4/3] dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-electric-800 dark:hover:bg-electric-950/30">
      <Icon className="h-5 w-5" aria-hidden="true" />
      {label}
      {input}
    </label>
  );
}

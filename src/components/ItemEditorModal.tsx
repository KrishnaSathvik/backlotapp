'use client';

import React, { useState } from 'react';
import { ArrowDown, ArrowUp, Film, ImagePlus, Trash2, Upload, X } from 'lucide-react';
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
import { FormSelect } from './CustomSelect';
import { MediaImage } from './MediaImage';

interface ItemEditorModalProps {
  isOpen: boolean;
  editingItem: ContentItem | null;
  channels: ChannelItem[];
  authToken: string | null;
  onClose: () => void;
  onSave: (payload: {
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
  }) => Promise<void>;
}

export const ItemEditorModal: React.FC<ItemEditorModalProps> = ({
  isOpen,
  editingItem,
  channels,
  authToken,
  onClose,
  onSave,
}) => {
  const [title, setTitle] = useState(editingItem?.title ?? '');
  const [platform, setPlatform] = useState<PlatformKey>(
    editingItem?.platform ?? 'youtube_long'
  );
  const [channelName, setChannelName] = useState(
    editingItem?.channelName ?? channels[0]?.name ?? ''
  );
  const [status, setStatus] = useState<StatusKey>(editingItem?.status ?? 'idea');
  const [caption, setCaption] = useState(editingItem?.caption ?? '');
  const [tagsRaw, setTagsRaw] = useState(
    editingItem ? formatTagsForCopy(editingItem.tags) : ''
  );
  const [notes, setNotes] = useState(editingItem?.notes ?? '');
  const [liveLink, setLiveLink] = useState(editingItem?.liveLink ?? '');
  const [postDate, setPostDate] = useState(editingItem?.postDate ?? '');
  const [targetDate, setTargetDate] = useState(editingItem?.targetDate ?? '');
  const [coverAsset, setCoverAsset] = useState<MediaAsset | null>(
    editingItem?.coverAsset ?? null
  );
  const [videoAsset, setVideoAsset] = useState<MediaAsset | null>(
    editingItem?.videoAsset ?? null
  );
  const [slides, setSlides] = useState<MediaAsset[]>(editingItem?.slides ?? []);

  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [uploadingLabel, setUploadingLabel] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleUploadCover = async (file: File) => {
    setUploadingLabel(`Uploading cover (${file.name})...`);
    setUploadPercent(0);
    try {
      const asset = await uploadAssetResumable({
        file,
        authToken,
        onProgress: setUploadPercent,
      });
      setCoverAsset(asset);
    } catch {
      setError('Cover upload failed. Please try again.');
    } finally {
      setUploadPercent(null);
      setUploadingLabel('');
    }
  };

  const handleUploadVideo = async (file: File) => {
    setUploadingLabel(`Uploading video (${formatFileSize(file.size)})...`);
    setUploadPercent(0);
    try {
      const asset = await uploadAssetResumable({
        file,
        authToken,
        onProgress: setUploadPercent,
      });
      setVideoAsset(asset);
    } catch {
      setError('Video upload failed. You can retry without losing progress.');
    } finally {
      setUploadPercent(null);
      setUploadingLabel('');
    }
  };

  const handleUploadSlides = async (fileList: FileList) => {
    const files = Array.from(fileList);
    if (!files.length) return;

    const uploaded: MediaAsset[] = [];
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      setUploadingLabel(`Uploading slide ${i + 1} of ${files.length}...`);
      setUploadPercent(0);
      const asset = await uploadAssetResumable({
        file,
        authToken,
        onProgress: setUploadPercent,
      });
      uploaded.push({ ...asset, order: slides.length + uploaded.length });
    }
    setSlides((prev) => [...prev, ...uploaded]);
    setUploadPercent(null);
    setUploadingLabel('');
  };

  const handleDropFiles = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (!files.length) return;

    const videoFile = files.find((f) => f.type.startsWith('video/'));
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));

    if (videoFile) {
      await handleUploadVideo(videoFile);
    }
    if (imageFiles.length === 1 && !coverAsset && slides.length === 0) {
      await handleUploadCover(imageFiles[0]);
    } else if (imageFiles.length > 0) {
      const dt = new DataTransfer();
      imageFiles.forEach((f) => dt.items.add(f));
      await handleUploadSlides(dt.files);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Title is required.');
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
        liveLink,
        postDate,
        targetDate,
        coverAsset,
        videoAsset,
        slides,
      });
      onClose();
    } catch {
      setError('Could not save item. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={editingItem ? `Edit ${editingItem.title}` : 'Add New Content Item'}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-6"
    >
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl border border-zinc-200 bg-white sm:rounded-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white/95 px-5 py-4 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/95">
          <div>
            <h2 className="text-lg font-bold text-zinc-950 dark:text-zinc-50">
              {editingItem ? 'Edit Content Item' : 'Add Content Item'}
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Only the title is required. Add files, caption, and tags anytime.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close editor"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 p-5">
          {/* Title (required) */}
          <div>
            <label
              htmlFor="editor-title"
              className="block text-xs font-semibold text-zinc-800 dark:text-zinc-200"
            >
              Title *
            </label>
            <input
              id="editor-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Minimalist Desk Camera Rig Breakdown"
              className="mt-1 h-11 w-full rounded-lg border border-zinc-200 bg-white px-3.5 text-sm text-zinc-950 focus:border-blue-600 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label
                htmlFor="editor-platform"
                className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
              >
                Platform
              </label>
              <FormSelect
                id="editor-platform"
                value={platform}
                onChange={(e) => setPlatform(e.target.value as PlatformKey)}
                className="mt-1 h-10"
              >
                {PLATFORM_OPTIONS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </FormSelect>
            </div>

            <div>
              <label
                htmlFor="editor-channel"
                className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
              >
                Channel
              </label>
              <FormSelect
                id="editor-channel"
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
                className="mt-1 h-10"
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
              <label
                htmlFor="editor-status"
                className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
              >
                Stage
              </label>
              <FormSelect
                id="editor-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as StatusKey)}
                className="mt-1 h-10"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </FormSelect>
            </div>
          </div>

          {/* Drag and Drop Zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDropFiles}
            className={`rounded-xl border-2 border-dashed p-4 transition-colors ${
              isDragOver
                ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/20'
                : 'border-zinc-300 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-900/50'
            }`}
          >
            <div className="flex flex-col items-center gap-2 text-center sm:flex-row sm:justify-between sm:text-left">
              <div className="flex items-center gap-3">
                <Upload className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                <div>
                  <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    Drag & drop video, cover, or slides here
                  </p>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Resumable chunked uploads support multi-GB video files.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">
                  <ImagePlus className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                  Cover
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUploadCover(f);
                    }}
                  />
                </label>

                <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">
                  <Film className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                  Video
                  <input
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUploadVideo(f);
                    }}
                  />
                </label>

                <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">
                  <ImagePlus className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                  Slides
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files) handleUploadSlides(e.target.files);
                    }}
                  />
                </label>
              </div>
            </div>

            {uploadPercent !== null ? (
              <div className="mt-3 space-y-1">
                <div className="flex justify-between text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
                  <span>{uploadingLabel}</span>
                  <span className="font-mono tabular-nums">{uploadPercent}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                  <div
                    className="h-full bg-blue-600 transition-all"
                    style={{ width: `${uploadPercent}%` }}
                  />
                </div>
              </div>
            ) : null}

            {/* Uploaded Cover & Video Summary */}
            {(coverAsset || videoAsset) && (
              <div className="mt-3 flex flex-wrap gap-3 border-t border-zinc-200 pt-3 text-xs dark:border-zinc-800">
                {coverAsset ? (
                  <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 dark:border-zinc-700 dark:bg-zinc-950">
                    <span className="font-medium">Cover: {coverAsset.name}</span>
                    <button
                      type="button"
                      onClick={() => setCoverAsset(null)}
                      aria-label="Remove cover"
                      className="text-zinc-400 hover:text-red-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : null}
                {videoAsset ? (
                  <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 dark:border-zinc-700 dark:bg-zinc-950">
                    <span className="font-medium">
                      Video: {videoAsset.name} ({formatFileSize(videoAsset.size)})
                    </span>
                    <button
                      type="button"
                      onClick={() => setVideoAsset(null)}
                      aria-label="Remove video"
                      className="text-zinc-400 hover:text-red-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : null}
              </div>
            )}

            {/* Slide Reordering */}
            {slides.length > 0 ? (
              <div className="mt-3 space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Carousel Slides ({slides.length}) — reorder sequence
                </p>
                <div className="space-y-1.5">
                  {slides.map((slide, idx) => (
                    <div
                      key={slide.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-950"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="w-5 text-center font-mono text-xs text-zinc-400 tabular-nums">
                          {idx + 1}
                        </span>
                        <div className="h-9 w-9 shrink-0 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-900">
                          <MediaImage src={slide.url} alt={slide.name} />
                        </div>
                        <span className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">
                          {slide.name}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => setSlides((s) => reorderSlides(s, idx, idx - 1))}
                          aria-label={`Move slide ${idx + 1} up`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded border border-zinc-200 text-zinc-600 hover:bg-zinc-100 disabled:opacity-30 dark:border-zinc-700 dark:text-zinc-300"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === slides.length - 1}
                          onClick={() => setSlides((s) => reorderSlides(s, idx, idx + 1))}
                          aria-label={`Move slide ${idx + 1} down`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded border border-zinc-200 text-zinc-600 hover:bg-zinc-100 disabled:opacity-30 dark:border-zinc-700 dark:text-zinc-300"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setSlides((prev) =>
                              prev
                                .filter((_, sIdx) => sIdx !== idx)
                                .map((s, order) => ({ ...s, order }))
                            )
                          }
                          aria-label={`Remove slide ${idx + 1}`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded text-zinc-400 hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="editor-caption"
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
            >
              Caption / Description
            </label>
            <textarea
              id="editor-caption"
              rows={3}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Write your YouTube description or Instagram caption..."
              className="mt-1 w-full rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-950 focus:border-blue-600 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="editor-tags"
                className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
              >
                Tags
              </label>
              <input
                id="editor-tags"
                type="text"
                value={tagsRaw}
                onChange={(e) => setTagsRaw(e.target.value)}
                placeholder="#filmmaking #desksetup #shorts"
                className="mt-1 h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-950 focus:border-blue-600 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
              />
            </div>

            <div>
              <label
                htmlFor="editor-target-date"
                className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
              >
                Target / Post Date
              </label>
              <input
                id="editor-target-date"
                type="date"
                value={postDate || targetDate}
                onChange={(e) => {
                  setTargetDate(e.target.value);
                  if (status === 'posted') setPostDate(e.target.value);
                }}
                className="mt-1 h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-950 focus:border-blue-600 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="editor-live-link"
                className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
              >
                Live Post Link
              </label>
              <input
                id="editor-live-link"
                type="url"
                value={liveLink}
                onChange={(e) => setLiveLink(e.target.value)}
                placeholder="https://..."
                className="mt-1 h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-950 focus:border-blue-600 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
              />
            </div>

            <div>
              <label
                htmlFor="editor-notes"
                className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
              >
                Notes
              </label>
              <input
                id="editor-notes"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Export settings, hook cue, sponsor note..."
                className="mt-1 h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-950 focus:border-blue-600 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
              />
            </div>
          </div>

          {error ? (
            <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || uploadPercent !== null}
              className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {saving
                ? 'Saving...'
                : editingItem
                ? 'Save Changes'
                : 'Create Post'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

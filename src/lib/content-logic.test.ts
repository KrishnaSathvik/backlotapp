import test from 'node:test';
import assert from 'node:assert/strict';
import {
  convertIdeaToPostDraft,
  extractDomainAndTitle,
  filterContentItems,
  platformOfChannel,
  postForAnotherChannel,
  postInChannel,
  formatFileSize,
  formatTagsForCopy,
  placeUploadedAssets,
  groupItemsByStatus,
  nextWorkflowStatus,
  parseTagsInput,
  prevWorkflowStatus,
  reorderSlides,
  sortContentItems,
  type ChannelItem,
  type ContentItem,
  type IdeaItem,
} from './content-logic.ts';

const sampleItems: ContentItem[] = [
  {
    id: 1,
    title: 'Desk Camera Rig Breakdown 2026',
    platform: 'youtube_long',
    channelName: 'Main Studio',
    status: 'ready',
    caption: 'Full overhead rig walkthrough with lighting diagram.',
    tags: ['filmmaking', 'desksetup', 'camera'],
    notes: 'Export 4K master',
    liveLink: '',
    postDate: '',
    targetDate: '2026-11-20',
    coverAsset: null,
    videoAsset: null,
    slides: [],
    attachedReferences: [],
    createdAt: '2026-11-10T10:00:00Z',
    updatedAt: '2026-11-12T10:00:00Z',
  },
  {
    id: 2,
    title: '5 Framing Rules for Carousels',
    platform: 'instagram_carousel',
    channelName: 'Visual Notes',
    status: 'posted',
    caption: 'Swipe through my grid composition checklist.',
    tags: ['carousel', 'design', 'instagram'],
    notes: 'Posted morning slot',
    liveLink: 'https://instagram.com/p/demo',
    postDate: '2026-11-14',
    targetDate: '2026-11-14',
    coverAsset: null,
    videoAsset: null,
    slides: [],
    attachedReferences: [],
    createdAt: '2026-11-09T10:00:00Z',
    updatedAt: '2026-11-14T10:00:00Z',
  },
];

test('filterContentItems filters by platform, channel, status, and search across title/caption/tags', () => {
  assert.equal(
    filterContentItems(sampleItems, {
      platform: 'instagram_carousel',
      channel: 'all',
      status: 'all',
      search: '',
    }).length,
    1
  );

  assert.equal(
    filterContentItems(sampleItems, {
      platform: 'all',
      channel: 'Main Studio',
      status: 'ready',
      search: 'desksetup',
    }).length,
    1
  );

  assert.equal(
    filterContentItems(sampleItems, {
      platform: 'all',
      channel: 'all',
      status: 'all',
      search: 'lighting diagram',
    })[0]?.id,
    1
  );
});

test('two channels with the same name keep their own icon and posts', () => {
  const youtube = { id: 1, name: 'CodeByKrishna', handle: 'https://youtube.com/@x', platform: 'youtube_long' as const };
  const instagram = { id: 2, name: 'CodeByKrishna', handle: 'https://instagram.com/x', platform: 'instagram_reel' as const };
  const channels = [youtube, instagram];
  const posts = [
    { channelId: 1, channelName: 'CodeByKrishna', platform: 'youtube_long' as const },
    { channelId: 1, channelName: 'CodeByKrishna', platform: 'youtube_long' as const },
    { channelId: null, channelName: 'CodeByKrishna', platform: 'youtube_long' as const },
  ];
  assert.equal(platformOfChannel(instagram, [], channels), 'instagram_reel');
  assert.equal(platformOfChannel(youtube, [], channels), 'youtube_long');
  assert.equal(posts.filter((p) => postInChannel(p, youtube, channels)).length, 3);
  assert.equal(posts.filter((p) => postInChannel(p, instagram, channels)).length, 0);
});

test('groupItemsByStatus groups items into the three stages', () => {
  const grouped = groupItemsByStatus(sampleItems);
  assert.equal(grouped.idea.length, 0);
  assert.equal(grouped.ready.length, 1);
  assert.equal(grouped.posted.length, 1);
});

test('placeUploadedAssets keeps a second video in the gallery instead of dropping it', () => {
  const file = (id: string, mimeType: string) => ({ id, name: id, url: id, mimeType, size: 1 });
  const next = placeUploadedAssets(
    { coverAsset: null, videoAsset: null, slides: [] },
    [file('clip-a', 'video/mp4'), file('clip-b', 'video/mp4'), file('still', 'image/jpeg')]
  );
  assert.equal(next.videoAsset?.id, 'clip-a');
  assert.deepEqual(
    next.slides.map((slide) => slide.id),
    ['clip-b', 'still']
  );
});

test('reorderSlides moves slides immutably and reassigns sequential order', () => {
  const slides = [
    { id: 'a', order: 0 },
    { id: 'b', order: 1 },
    { id: 'c', order: 2 },
  ];
  const reordered = reorderSlides(slides, 2, 0);
  assert.deepEqual(
    reordered.map((s) => ({ id: s.id, order: s.order })),
    [
      { id: 'c', order: 0 },
      { id: 'a', order: 1 },
      { id: 'b', order: 2 },
    ]
  );
  assert.equal(slides[0].id, 'a');
});

test('parseTagsInput & formatTagsForCopy normalize hashtags without duplicates', () => {
  const tags = parseTagsInput('#Reels, filmmaking #REELS  studio ');
  assert.deepEqual(tags, ['Reels', 'filmmaking', 'studio']);
  assert.equal(formatTagsForCopy(tags), '#Reels #filmmaking #studio');
});

test('extractDomainAndTitle extracts domain and suggested title for YouTube/Instagram links', () => {
  const yt = extractDomainAndTitle('https://www.youtube.com/shorts/abc123');
  assert.equal(yt.domain, 'youtube.com');
  assert.match(yt.suggestedTitle, /YouTube Short Reference/);

  const ig = extractDomainAndTitle('instagram.com/reel/xyz');
  assert.equal(ig.domain, 'instagram.com');
  assert.match(ig.suggestedTitle, /Instagram Reel Reference/);
});

test('convertIdeaToPostDraft carries attached references, platform, channel, tags, and targetDate', () => {
  const idea: IdeaItem = {
    id: 42,
    title: 'Blue Hour B-Roll Pacing',
    linkUrl: 'https://youtube.com/watch?v=test',
    linkTitle: 'Coastal Road Edit',
    linkDomain: 'youtube.com',
    screenshotUrl: '/covers/cover_travel_vlog.jpg',
    notes: 'Use 24fps slow push-ins for intro.',
    platform: 'youtube_long',
    channelName: 'Field Notes',
    tags: ['travel', 'colorgrading'],
    targetDate: '2026-12-01',
    createdAt: '2026-11-15T12:00:00Z',
  };

  const draft = convertIdeaToPostDraft(idea);
  assert.equal(draft.title, 'Blue Hour B-Roll Pacing');
  assert.equal(draft.status, 'idea');
  assert.equal(draft.channelName, 'Field Notes');
  assert.equal(draft.sourceIdeaId, 42);
  assert.equal(draft.attachedReferences.length, 1);
  assert.equal(draft.attachedReferences[0].url, 'https://youtube.com/watch?v=test');
  assert.equal(draft.attachedReferences[0].screenshotUrl, '/covers/cover_travel_vlog.jpg');
});

test('workflow status stepping and file size formatting work predictably', () => {
  assert.equal(nextWorkflowStatus('idea'), 'ready');
  assert.equal(nextWorkflowStatus('scripting'), 'ready');
  assert.equal(nextWorkflowStatus('posted'), 'posted');
  assert.equal(prevWorkflowStatus('ready'), 'idea');
  assert.equal(prevWorkflowStatus('editing'), 'idea');
  assert.equal(prevWorkflowStatus('idea'), 'idea');
  assert.equal(formatFileSize(1536), '1.5 KB');
  assert.equal(formatFileSize(2 * 1024 * 1024 * 1024), '2.0 GB');
});

test('sortContentItems orders by target date with undated posts last', () => {
  const base = sampleItems[0];
  const mk = (id: number, targetDate: string, postDate = '', updatedAt = '2026-01-01T00:00:00Z'): ContentItem => ({
    ...base,
    id,
    targetDate,
    postDate,
    updatedAt,
  });
  const items = [mk(1, ''), mk(2, '2026-12-01'), mk(3, '', '2026-11-10'), mk(4, '2026-11-20')];
  assert.deepEqual(sortContentItems(items, 'target').map((i) => i.id), [3, 4, 2, 1]);
  assert.deepEqual(items.map((i) => i.id), [1, 2, 3, 4], 'does not mutate input');
});

test('sortContentItems orders by most recently updated and newest created', () => {
  const base = sampleItems[0];
  const items: ContentItem[] = [
    { ...base, id: 1, updatedAt: '2026-01-02T00:00:00Z', createdAt: '2026-01-03T00:00:00Z' },
    { ...base, id: 2, updatedAt: '2026-01-05T00:00:00Z', createdAt: '2026-01-01T00:00:00Z' },
  ];
  assert.deepEqual(sortContentItems(items, 'updated').map((i) => i.id), [2, 1]);
  assert.deepEqual(sortContentItems(items, 'created').map((i) => i.id), [1, 2]);
});

test('postForAnotherChannel reuses files and starts planned on the other channel', () => {
  const source: ContentItem = {
    ...sampleItems[0],
    platform: 'instagram_reel',
    channelId: 1,
    channelName: 'Design Feed',
    status: 'posted',
    liveLink: 'https://instagram.com/p/abc',
    postDate: '2026-11-12',
    targetDate: '2026-11-12',
    coverAsset: { id: 'cover', name: 'cover.jpg', url: '/api/files/same-cover', mimeType: 'image/jpeg', size: 10 },
    videoAsset: { id: 'video', name: 'clip.mp4', url: '/api/files/same-video', mimeType: 'video/mp4', size: 20 },
    slides: [{ id: 'slide', name: 'slide.jpg', url: '/api/files/same-slide', mimeType: 'image/jpeg', size: 5 }],
  };
  const channels: ChannelItem[] = [
    { id: 1, name: 'Design Feed', handle: '', platform: 'instagram_reel' },
    { id: 2, name: 'Field Notes', handle: '', platform: 'tiktok' },
  ];
  const draft = postForAnotherChannel(source, channels[1], [source], channels);
  assert.equal(draft.platform, 'tiktok');
  assert.equal(draft.channelId, 2);
  assert.equal(draft.channelName, 'Field Notes');
  assert.equal(draft.status, 'idea');
  assert.equal(draft.liveLink, '');
  assert.equal(draft.postDate, '');
  assert.equal(draft.targetDate, '');
  assert.equal(draft.coverAsset?.url, '/api/files/same-cover');
  assert.equal(draft.videoAsset?.url, '/api/files/same-video');
  assert.equal(draft.slides[0]?.url, '/api/files/same-slide');
  assert.notEqual(draft.coverAsset, source.coverAsset);
  assert.equal(draft.caption, source.caption);
});

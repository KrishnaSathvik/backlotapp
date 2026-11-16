import test from 'node:test';
import assert from 'node:assert/strict';
import {
  convertIdeaToPostDraft,
  extractDomainAndTitle,
  filterContentItems,
  formatFileSize,
  formatTagsForCopy,
  groupItemsByStatus,
  nextWorkflowStatus,
  parseTagsInput,
  prevWorkflowStatus,
  reorderSlides,
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

test('groupItemsByStatus groups items into all 5 workflow columns', () => {
  const grouped = groupItemsByStatus(sampleItems);
  assert.equal(grouped.idea.length, 0);
  assert.equal(grouped.ready.length, 1);
  assert.equal(grouped.posted.length, 1);
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
  assert.equal(nextWorkflowStatus('idea'), 'scripting');
  assert.equal(nextWorkflowStatus('posted'), 'posted');
  assert.equal(prevWorkflowStatus('ready'), 'editing');
  assert.equal(prevWorkflowStatus('idea'), 'idea');
  assert.equal(formatFileSize(1536), '1.5 KB');
  assert.equal(formatFileSize(2 * 1024 * 1024 * 1024), '2.0 GB');
});

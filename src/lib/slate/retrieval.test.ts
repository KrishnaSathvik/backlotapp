import test from 'node:test';
import assert from 'node:assert/strict';
import { gatherContext } from './retrieval.ts';
import { ALICE, BOB, idea, MemoryStore, post } from './test-fixtures.ts';

const TODAY = '2026-11-17';

function workspace() {
  return new MemoryStore()
    .addChannel(ALICE, { id: 1, name: 'Main Studio', handle: '@mainstudio' })
    .addChannel(ALICE, { id: 2, name: 'Design Feed', handle: '@designfeed' })
    .addChannel(BOB, { id: 9, name: 'Bob Cooks', handle: '@bob' })
    .addPost(ALICE, post(10, { title: 'Tokyo After Dark', channelId: 1, channelName: 'Main Studio', caption: 'Neon, rain and 35mm.', targetDate: '2026-11-22' }))
    .addPost(ALICE, post(11, { title: 'Podcast Setup', channelId: 1, channelName: 'Main Studio', status: 'idea', targetDate: '2026-12-02' }))
    .addPost(ALICE, post(12, { title: 'Golden Ridge', channelId: 2, channelName: 'Design Feed', status: 'posted', postDate: '2026-11-12' }))
    .addPost(BOB, post(50, { title: 'Bob secret pasta', channelId: 9, channelName: 'Bob Cooks', caption: 'BOB-PRIVATE-CAPTION' }))
    .addIdea(ALICE, idea(20, { title: 'Desk lighting flip', channelName: 'Main Studio' }))
    .addIdea(BOB, idea(60, { title: 'Bob private idea', notes: 'BOB-PRIVATE-NOTE' }))
    .addPreference(ALICE, { channelId: null, key: 'emoji_usage', value: 'none' })
    .addPreference(ALICE, { channelId: null, key: 'caption_length', value: 'medium' })
    .addPreference(ALICE, { channelId: 1, key: 'caption_length', value: 'short' })
    .addPreference(BOB, { channelId: null, key: 'tone', value: 'playful' });
}

test('focused post owned by the user is included in full and marked as a safe reference', async () => {
  const r = await gatherContext(workspace(), { uid: ALICE, question: 'Give me 5 hooks', focus: { type: 'post', id: 10 }, channelId: null, today: TODAY });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.task, 'create');
  assert.match(r.context, /Focused post \(id 10\)/);
  assert.match(r.context, /Neon, rain and 35mm\./);
  assert.deepEqual(r.knownRefs, [{ type: 'post', id: 10, title: 'Tokyo After Dark' }]);
});

test("another user's post, idea or channel is rejected with the same 404 as a missing one", async () => {
  const post50 = await gatherContext(workspace(), { uid: ALICE, question: 'x', focus: { type: 'post', id: 50 }, channelId: null, today: TODAY });
  const missing = await gatherContext(workspace(), { uid: ALICE, question: 'x', focus: { type: 'post', id: 9999 }, channelId: null, today: TODAY });
  assert.deepEqual(post50, { ok: false, status: 404, error: 'That post isn’t in your Backlot.' });
  assert.deepEqual(post50, missing);
  const idea60 = await gatherContext(workspace(), { uid: ALICE, question: 'x', focus: { type: 'idea', id: 60 }, channelId: null, today: TODAY });
  assert.equal(idea60.ok, false);
  const channel9 = await gatherContext(workspace(), { uid: ALICE, question: 'x', focus: null, channelId: 9, today: TODAY });
  assert.deepEqual(channel9, { ok: false, status: 404, error: 'That channel isn’t in your Backlot.' });
});

test('the starting context is small: channels with ids, no fixed post or idea lists', async () => {
  const store = workspace();
  const r = await gatherContext(store, { uid: ALICE, question: 'What should I work on this week?', focus: null, channelId: null, today: TODAY });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.match(r.context, /"Main Studio" \(channel_id 1, @mainstudio\)/);
  assert.match(r.context, /Today: 2026-11-17/);
  assert.doesNotMatch(r.context, /Tokyo After Dark|Podcast Setup|Golden Ridge|Desk lighting/);
  assert.ok(!store.calls.some((c) => c.startsWith('listPosts') || c === 'listIdeas' || c.startsWith('search')));
});

test("no request pulls another user's data into the context", async () => {
  for (const question of ['Plan my week', 'Write a caption', 'What ideas do I have?', 'hello']) {
    const r = await gatherContext(workspace(), { uid: ALICE, question, focus: null, channelId: null, today: TODAY });
    assert.ok(r.ok);
    if (r.ok) assert.doesNotMatch(r.context, /BOB-PRIVATE|Bob secret|Bob Cooks|Bob private|playful/);
  }
});

test('global preferences apply; a channel preference overrides for that channel', async () => {
  const global = await gatherContext(workspace(), { uid: ALICE, question: 'Write a caption', focus: null, channelId: null, today: TODAY });
  assert.ok(global.ok);
  if (!global.ok) return;
  assert.match(global.context, /saved preferences for all channels/);
  assert.match(global.context, /Emoji use: "none"/);
  assert.match(global.context, /Caption length: "medium"/);

  const scoped = await gatherContext(workspace(), { uid: ALICE, question: 'Write a caption', focus: null, channelId: 1, today: TODAY });
  assert.ok(scoped.ok);
  if (!scoped.ok) return;
  assert.match(scoped.context, /saved preferences for "Main Studio"/);
  assert.match(scoped.context, /Caption length: "short" \(this channel\)/);
  assert.match(scoped.context, /Emoji use: "none"/, 'global still applies where the channel has no value');

  // The focused post's channel is used when no scope is set.
  const focused = await gatherContext(workspace(), { uid: ALICE, question: 'Shorten the caption', focus: { type: 'post', id: 10 }, channelId: null, today: TODAY });
  assert.ok(focused.ok && /Caption length: "short"/.test(focused.context));
});

test('an empty workspace is stated plainly so Slate can say it lacks context', async () => {
  const r = await gatherContext(new MemoryStore(), { uid: ALICE, question: 'Plan my week', focus: null, channelId: null, today: TODAY });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.match(r.context, /Channels: none yet/);
  assert.match(r.context, /saved preferences: none yet/);
});

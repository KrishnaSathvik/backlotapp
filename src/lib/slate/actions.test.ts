import test from 'node:test';
import assert from 'node:assert/strict';
import { ALICE, BOB, idea, MemoryStore, post } from './test-fixtures.ts';
import { ACTION_TOOL_DEFINITIONS, ALL_TOOL_DEFINITIONS, executeTool, TOOL_LIMITS, type ToolContext, type ToolOutcome } from './tools.ts';
import { ActionInputError, validateEdits, validDate, type ActionDraft, type ActionView } from './actions.ts';
import { createReplyStream, readStreamEvents, type StreamEvent } from './stream.ts';
import type { RoundEvent, SlateProvider, ToolCall } from './providers.ts';

/** Proposal tools (M3): they validate and describe a change, and never write anything. */

function store() {
  return new MemoryStore()
    .addChannel(ALICE, { id: 1, name: 'Main Studio', handle: '@main' })
    .addChannel(BOB, { id: 9, name: 'Bob Cooks', handle: '' })
    .addPost(ALICE, post(10, { title: 'Tokyo After Dark', caption: 'Old caption', tags: ['tokyo'], status: 'editing', targetDate: '2026-11-22', version: 4 }))
    .addPost(ALICE, post(11, { title: 'Podcast Setup', status: 'idea', version: 1 }))
    .addPost(ALICE, post(12, { title: 'Latte Art', status: 'ready', targetDate: '2026-11-19', version: 2 }))
    .addPost(BOB, post(50, { title: 'Bob ramen', caption: 'BOB-PRIVATE', version: 1 }))
    .addIdea(ALICE, idea(20, { title: 'AI agents explained', version: 3 }))
    .addIdea(ALICE, idea(21, { title: 'Already converted', convertedItemId: 11 }))
    .addIdea(BOB, idea(60, { title: 'Bob idea' }));
}

const ctx = (s = store()): ToolContext => ({ uid: ALICE, store: s, today: '2026-11-17', budget: { chars: TOOL_LIMITS.totalResultChars } });
const run = async (name: string, args: unknown, c = ctx()) => {
  const o = await executeTool(name, args, c);
  return { ...o, data: JSON.parse(o.output) };
};
const snapshot = (s: MemoryStore) => JSON.stringify([s.posts, s.ideas, s.channels, s.preferences]);

test('M3-1. propose_post_update returns a reviewable draft with the base version and changes nothing', async () => {
  const s = store();
  const before = snapshot(s);
  const r = await run('propose_post_update', { post_id: 10, caption: 'New caption', tags: ['#Tokyo', 'night', 'tokyo'], title: 'Tokyo After Dark', reason: 'Tighter.' }, ctx(s));
  assert.equal(r.ok, true);
  assert.equal(r.data.applied, false);
  assert.equal(r.data.status, 'awaiting_creator_approval');
  assert.equal(r.actions?.length, 1);
  const d = r.actions![0];
  assert.equal(d.kind, 'post_update');
  assert.equal(d.baseVersion, 4);
  assert.deepEqual(d.target, { type: 'post', id: 10, title: 'Tokyo After Dark' });
  // Unchanged fields (the identical title, the same tag set) are left out.
  assert.deepEqual(d.changes, { caption: 'New caption', tags: ['Tokyo', 'night'] });
  assert.deepEqual(d.before, { caption: 'Old caption', tags: ['tokyo'] });
  assert.equal(snapshot(s), before, 'nothing in the workspace changed');
});

test("M3-2. another user's post, a missing post and a foreign channel are all not found", async () => {
  const foreign = await run('propose_post_update', { post_id: 50, caption: 'x' });
  const missing = await run('propose_post_update', { post_id: 9999, caption: 'x' });
  assert.equal(foreign.output, missing.output);
  assert.equal(foreign.data.error, 'not_found');
  assert.equal(foreign.actions, undefined);
  assert.doesNotMatch(foreign.output, /BOB|ramen/);
  const chan = await run('propose_post_creation', { title: 'New', channel_id: 9 });
  assert.equal(chan.data.error, 'not_found');
  const ideaForeign = await run('propose_idea_conversion', { idea_id: 60 });
  assert.equal(ideaForeign.data.error, 'not_found');
});

test('M3-3. proposals that change nothing are refused', async () => {
  const same = await run('propose_stage_change', { post_id: 10, stage: 'editing' });
  assert.equal(same.data.error, 'no_change');
  assert.equal(same.actions, undefined);
});

test('M3-4. arguments are validated strictly (stages, dates, lengths, unknown fields, uid injection)', async () => {
  const cases: [string, unknown][] = [
    ['propose_stage_change', { post_id: 10, stage: 'published' }],
    ['propose_target_date', { post_id: 10, target_date: '2026-02-30' }],
    ['propose_target_date', { post_id: 10, target_date: 'next friday' }],
    ['propose_target_date', { post_id: 10 }],
    ['propose_post_update', { post_id: 10, caption: 'x'.repeat(5001) }],
    ['propose_post_update', { post_id: 10, title: '   ' }],
    ['propose_post_update', { post_id: 10 }],
    ['propose_post_update', { post_id: 10, caption: 'x', user_uid: BOB }],
    ['propose_post_update', { post_id: 10, status: 'posted' }],
    ['propose_post_creation', { title: 'x', stage: 'posted' }],
    ['propose_post_creation', { title: 'x', platform: 'myspace' }],
    ['propose_post_update', { post_id: '10', caption: 'x' }],
  ];
  for (const [name, args] of cases) {
    const r = await run(name, args);
    assert.equal(r.ok, false, `${name} ${JSON.stringify(args)}`);
    assert.equal(r.actions, undefined);
  }
  assert.equal(validDate(''), '');
  assert.throws(() => validDate('2026-13-01'), ActionInputError);
});

test('M3-5. batches: at most 5 posts, each once; missing posts are skipped; drafts share a batch', async () => {
  const six = Array.from({ length: 6 }, (_, i) => ({ post_id: 10 + i, stage: 'ready' }));
  assert.equal((await run('propose_batch_updates', { updates: six })).data.error, 'invalid_arguments');
  const dup = await run('propose_batch_updates', { updates: [{ post_id: 10, stage: 'ready' }, { post_id: 10, target_date: '2026-12-01' }] });
  assert.equal(dup.data.error, 'invalid_arguments');

  const r = await run('propose_batch_updates', {
    updates: [
      { post_id: 10, target_date: '2026-11-25' },
      { post_id: 11, stage: 'scripting', target_date: '2026-11-28' },
      { post_id: 50, target_date: '2026-11-30' },
      { post_id: 12, stage: 'ready' },
    ],
    reason: 'Spread out the week.',
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.actions!.map((d) => [d.target?.id, d.kind]), [[10, 'target_date'], [11, 'post_update']]);
  assert.deepEqual(r.data.skipped, [{ post_id: 50, why: 'not_found' }, { post_id: 12, why: 'no_change' }]);
  assert.ok(r.actions!.every((d) => d.batchKey && d.batchKey === r.actions![0].batchKey));
});

test('M3-6. drafts and idea conversions: validated, never applied by the tool', async () => {
  const s = store();
  const before = snapshot(s);
  const c = await run('propose_post_creation', { title: 'Shibuya rain BTS', channel_id: 1, platform: 'youtube_shorts', tags: ['bts'], target_date: '2026-12-01' }, ctx(s));
  assert.deepEqual(c.actions![0].draft, { title: 'Shibuya rain BTS', platform: 'youtube_shorts', channelId: 1, channelName: 'Main Studio', caption: '', tags: ['bts'], notes: '', targetDate: '2026-12-01' });
  assert.equal(c.actions![0].target, null);

  const conv = await run('propose_idea_conversion', { idea_id: 20 }, ctx(s));
  assert.deepEqual([conv.actions![0].kind, conv.actions![0].baseVersion, conv.actions![0].target?.id], ['idea_convert', 3, 20]);
  const again = await run('propose_idea_conversion', { idea_id: 21 }, ctx(s));
  assert.equal(again.data.error, 'already_converted');
  assert.equal(snapshot(s), before);
});

test('M3-7. creator edits are re-validated and limited to the proposed fields', () => {
  assert.deepEqual(validateEdits('post_update', ['caption'], { caption: '  Edited  ' }), { caption: 'Edited' });
  assert.throws(() => validateEdits('post_update', ['caption'], { title: 'Sneaky' }), /can't be edited/);
  assert.throws(() => validateEdits('post_update', ['caption'], { caption: 'x'.repeat(5001) }), /too long/);
  assert.throws(() => validateEdits('stage_change', ['status'], { status: 'deleted' }), ActionInputError);
  assert.throws(() => validateEdits('target_date', ['targetDate'], { targetId: 50 }), /can't be edited/);
  assert.throws(() => validateEdits('idea_convert', [], { title: 'x' }), /can't be edited/);
  assert.deepEqual(validateEdits('post_create', [], { caption: 'Added' }), { caption: 'Added' });
  assert.throws(() => validateEdits('post_create', [], { status: 'posted' }), /can't be edited/);
});

test('M3-8. the model has no tool to apply, delete or publish', () => {
  const names = ALL_TOOL_DEFINITIONS.map((t) => t.name);
  for (const forbidden of ['apply_action', 'delete_post', 'delete_idea', 'publish_post', 'update_post', 'save_preference']) assert.ok(!names.includes(forbidden));
  for (const t of ACTION_TOOL_DEFINITIONS) assert.match(t.description, /changes NOTHING/);
});

/* ---------------- stream: drafts are saved only for a completed reply ---------------- */

type Step = { text: string } | { tools: ToolCall[] } | { fail: true } | { abort: AbortController };

function fake(id: 'openai' | 'anthropic', script: Step[]): SlateProvider & { calls: number } {
  const p = {
    id,
    model: `${id}-m`,
    calls: 0,
    start() {
      p.calls += 1;
      let at = 0;
      return {
        async *round(): AsyncIterable<RoundEvent> {
          while (at < script.length) {
            const step = script[at++];
            await new Promise((r) => setTimeout(r, 1));
            if ('fail' in step) throw Object.assign(new Error('503'), { kind: 'transient' });
            if ('abort' in step) {
              step.abort.abort();
              continue;
            }
            if ('tools' in step) {
              yield { type: 'end', result: { toolCalls: step.tools, finishReason: 'TOOL_CALLS' } };
              return;
            }
            yield { type: 'text', text: step.text };
          }
          yield { type: 'end', result: { toolCalls: [], finishReason: 'STOP' } };
        },
        addToolResults() {},
      };
    },
    classify: (err: unknown) => ((err as { kind?: string }).kind === 'transient' ? ('transient' as const) : ('aborted' as const)),
  };
  return p;
}

const proposeCall: ToolCall = { id: 'c1', name: 'propose_stage_change', args: { post_id: 10, stage: 'ready' } };
const draftTool = (tag: string) => async (): Promise<ToolOutcome> => ({
  output: '{"proposed":1}',
  refs: [],
  label: 'Preparing',
  ok: true,
  actions: [{ kind: 'stage_change', target: { type: 'post', id: 10, title: tag }, baseVersion: 4, changes: { status: 'ready' }, before: { status: 'editing' }, summary: 'Move to Ready', reason: '' }],
});

function streamWith(providers: SlateProvider[], runTool: () => Promise<ToolOutcome>, persist: (d: ActionDraft[]) => Promise<ActionView[]>, signal = new AbortController().signal) {
  return createReplyStream(providers, { systemInstruction: 's', contents: [], task: 'create', maxOutputTokens: 100, tools: ALL_TOOL_DEFINITIONS }, {
    signal,
    deadlineMs: 5000,
    firstOutputMs: 2000,
    fallbackEnabled: true,
    maxFallbackAttempts: 1,
    retryDelayMs: () => 1,
    runTool,
    persistActions: persist,
  });
}
async function collect(s: ReadableStream<Uint8Array>) {
  const out: StreamEvent[] = [];
  for await (const e of readStreamEvents(s)) out.push(e);
  return out;
}
const view = (d: ActionDraft, i: number): ActionView => ({ id: `id-${i}`, kind: d.kind, status: 'pending', batchId: null, target: d.target, changes: d.changes, before: d.before, summary: d.summary, reason: d.reason, expiresAt: '', resultPostId: null, resultIdeaId: null });

test('M3-9. suggested actions are saved once the reply completes, and sent after the text', async () => {
  const saved: ActionDraft[][] = [];
  const o = fake('openai', [{ tools: [proposeCall] }, { text: 'Ready for you to review.' }]);
  const events = await collect(streamWith([o], draftTool('A'), async (d) => (saved.push(d), d.map(view))));
  assert.equal(saved.length, 1);
  const types = events.map((e) => e.type);
  assert.ok(types.indexOf('actions') > types.lastIndexOf('delta'));
  assert.equal(types.at(-1), 'done');
});

test('M3-10. a discarded attempt leaves nothing behind: after fallback only the answering attempt is saved', async () => {
  const saved: ActionDraft[][] = [];
  const o = fake('openai', [{ tools: [proposeCall] }, { fail: true }]);
  const c = fake('anthropic', [{ tools: [proposeCall] }, { text: 'Claude: ready to review.' }]);
  let n = 0;
  const tool = async () => draftTool(n++ === 0 ? 'from-openai' : 'from-claude')();
  await collect(streamWith([o, c], tool, async (d) => (saved.push(d), d.map(view))));
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].map((d) => d.target?.title), ['from-claude']);
});

test('M3-11. Stop during a proposal: nothing is saved', async () => {
  const user = new AbortController();
  let persisted = 0;
  const o = fake('openai', [{ tools: [proposeCall] }, { abort: user }, { text: 'never' }]);
  await collect(streamWith([o], draftTool('A'), async (d) => (persisted++, d.map(view)), user.signal));
  assert.equal(persisted, 0);
});

test('M3-12. if saving suggestions fails, the creator gets a notice instead of cards', async () => {
  const o = fake('openai', [{ tools: [proposeCall] }, { text: 'Ready.' }]);
  const events = await collect(streamWith([o], draftTool('A'), async () => Promise.reject(new Error('db down'))));
  assert.ok(events.some((e) => e.type === 'notice'));
  assert.ok(!events.some((e) => e.type === 'actions'));
  assert.equal(events.at(-1)?.type, 'done');
});

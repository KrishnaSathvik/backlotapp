import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasLinkPreview, isTikTokLink, oembedUrl, youtubeId, youtubeThumbnail } from './link-preview.ts';

test('LP1. YouTube ids from every common link shape; nothing from look-alikes', () => {
  const id = 'dQw4w9WgXcQ';
  for (const u of [
    `https://www.youtube.com/watch?v=${id}`,
    `youtube.com/watch?v=${id}&t=42s`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}?si=abc`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/live/${id}`,
    `https://www.youtube.com/embed/${id}`,
  ]) assert.equal(youtubeId(u), id, u);
  for (const u of ['https://www.youtube.com/@channel', 'https://evil.example/watch?v=dQw4w9WgXcQ', 'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ', 'not a url', '', `https://www.youtube.com/watch?v=short`]) {
    assert.equal(youtubeId(u), null, u);
  }
  assert.equal(youtubeThumbnail(`https://youtu.be/${id}`), `https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
});

test('LP2. TikTok links; only the fixed oEmbed endpoints are ever requested', () => {
  assert.ok(isTikTokLink('https://www.tiktok.com/@user/video/7300000000000000000'));
  assert.ok(isTikTokLink('https://vm.tiktok.com/ZMabc/'));
  assert.ok(!isTikTokLink('https://tiktok.com.evil.example/x'));
  assert.ok(!hasLinkPreview('https://www.instagram.com/reel/abc/'));
  assert.match(oembedUrl('https://youtu.be/dQw4w9WgXcQ')!, /^https:\/\/www\.youtube\.com\/oembed\?/);
  assert.match(oembedUrl('https://www.tiktok.com/@u/video/1')!, /^https:\/\/www\.tiktok\.com\/oembed\?url=/);
  assert.equal(oembedUrl('https://example.com/video'), null);
});

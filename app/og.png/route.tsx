import fs from 'node:fs/promises';
import path from 'node:path';
import { ImageResponse } from 'next/og';

/**
 * Social preview image (1200×630) for every public page: the Backlot mark and tagline beside a
 * real Library screenshot (public/screens, captured from the app with sample data). Rendered once
 * at build time.
 */
export const dynamic = 'force-static';

const W = 1200;
const H = 630;

async function dataUrl(file: string, type: string) {
  const buf = await fs.readFile(path.join(process.cwd(), 'public', file));
  return `data:${type};base64,${buf.toString('base64')}`;
}

/* eslint-disable @next/next/no-img-element -- ImageResponse (Satori) renders plain <img>, not next/image. */
export async function GET() {
  const [mark, shot] = await Promise.all([
    dataUrl('brand/backlot-mark-512.png', 'image/png'),
    dataUrl('screens/desktop-library-light.jpg', 'image/jpeg'),
  ]);

  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: 'flex', background: '#ffffff', position: 'relative', overflow: 'hidden' }}>
        <div
          style={{
            position: 'absolute',
            right: -160,
            top: -160,
            width: 560,
            height: 560,
            borderRadius: 9999,
            background: 'radial-gradient(circle, rgba(46,102,255,0.22), rgba(46,102,255,0) 70%)',
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 0 0 72px', width: 520 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <img src={mark} width={72} height={72} style={{ borderRadius: 18 }} alt="" />
            <div style={{ fontSize: 44, fontWeight: 700, color: '#07080c', letterSpacing: -1 }}>Backlot</div>
          </div>
          <div style={{ marginTop: 36, fontSize: 56, fontWeight: 800, lineHeight: 1.02, color: '#07080c', letterSpacing: -2 }}>
            Every post,
          </div>
          <div style={{ fontSize: 56, fontWeight: 800, lineHeight: 1.02, color: '#1a4dff', letterSpacing: -2 }}>one backlot.</div>
          <div style={{ marginTop: 28, fontSize: 24, lineHeight: 1.4, color: '#4a5060' }}>
            The private workspace for creators: covers, videos, captions, hashtags and ideas, with Slate, your AI creative partner.
          </div>
        </div>
        <div style={{ display: 'flex', position: 'absolute', left: 600, top: 70 }}>
          <img
            src={shot}
            width={800}
            height={500}
            style={{ borderRadius: 20, border: '1px solid #e2e4e9', boxShadow: '0 30px 80px -30px rgba(10,20,60,0.35)' }}
            alt=""
          />
        </div>
      </div>
    ),
    { width: W, height: H }
  );
}

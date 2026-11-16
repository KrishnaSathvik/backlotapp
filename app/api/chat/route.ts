import { NextRequest, NextResponse } from 'next/server';
import { getGeminiClient } from '@/src/lib/gemini.ts';

interface ChatMessageInput {
  role: 'user' | 'model';
  text: string;
}

function formatReadableError(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.error?.message) {
      return String(parsed.error.message);
    }
  } catch {
    // Not raw JSON
  }
  return raw;
}

function isRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('429') ||
    msg.includes('high demand') ||
    msg.includes('ECONNRESET')
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const messages = Array.isArray(body.messages)
      ? (body.messages as ChatMessageInput[])
      : [];
    const vaultContext =
      typeof body.context === 'string' ? body.context.trim() : '';

    if (messages.length === 0) {
      return NextResponse.json(
        { error: 'Please enter a message.' },
        { status: 400 }
      );
    }

    const latest = messages[messages.length - 1];
    if (!latest || latest.role !== 'user' || !latest.text.trim()) {
      return NextResponse.json(
        { error: 'Latest message must be non-empty user text.' },
        { status: 400 }
      );
    }

    const priorHistory = messages.slice(0, -1).map((m) => ({
      role: m.role,
      parts: [{ text: m.text }],
    }));

    const systemInstruction = [
      'You are Content Vault Studio Strategist, a concise, practical assistant for a solo creator managing YouTube long-form videos, YouTube Shorts, Instagram Reels, Instagram carousels, and content ideas.',
      'Help the creator write punchy hooks, high-retention captions, clean hashtag sets, title variations, and workflow planning across their channels.',
      'Keep replies structured, actionable, and easy to copy-paste.',
      vaultContext ? `Current creator vault snapshot:\n${vaultContext}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const ai = getGeminiClient();

    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const chat = ai.chats.create({
          model: 'gemini-4-hydrogen',
          history: priorHistory,
          config: {
            systemInstruction,
          },
        });

        const response = await chat.sendMessage({
          message: latest.text.trim(),
        });

        const reply = response.text ?? '';
        return NextResponse.json({ reply });
      } catch (err) {
        lastError = err;
        if (!isRetryableError(err) || attempt === 2) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
      }
    }

    throw lastError;
  } catch (error) {
    console.error('Gemini chat error:', error);
    const rawMsg =
      error instanceof Error ? error.message : 'Failed to generate AI response.';
    const readable = formatReadableError(rawMsg);
    const status = rawMsg.includes('GEMINI_API_KEY') ? 500 : 502;
    return NextResponse.json({ error: readable }, { status });
  }
}

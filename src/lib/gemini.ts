import { GoogleGenAI } from '@google/genai';

/** Override with GEMINI_MODEL in the environment. */
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-4-hydrogen';

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in the server environment.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

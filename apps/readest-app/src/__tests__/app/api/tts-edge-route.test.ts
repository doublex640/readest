import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Anonymous caller: the web demo has no account backend at all.
vi.mock('@/utils/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/access')>()),
  validateUserAndToken: async () => ({}),
}));

// The gate is decided when the route module loads, so each case needs a fresh
// copy of it under its own NODE_ENV.
const loadPost = async (nodeEnv: string) => {
  vi.stubEnv('NODE_ENV', nodeEnv);
  vi.resetModules();
  const route = await import('@/app/api/tts/edge/route');
  return route.POST;
};

const post = (body: unknown) =>
  new NextRequest('https://web.readest.com/api/tts/edge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('POST /api/tts/edge auth gate', () => {
  it('refuses an anonymous request in a production build', async () => {
    const POST = await loadPost('production');

    const response = await POST(post({ input: 'hello', voice: 'en-US-AriaNeural' }));

    expect(response.status).toBe(403);
  });

  it('lets a development build synthesize for a signed-out reader', async () => {
    const POST = await loadPost('development');

    // No `input`: getting as far as validation proves the gate let it through
    // without touching the synthesis network.
    const response = await POST(post({}));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { type: 'invalid_request_error' },
    });
  });
});

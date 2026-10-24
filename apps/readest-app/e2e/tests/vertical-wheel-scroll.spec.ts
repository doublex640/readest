import { existsSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/base';
import type { ReaderPage } from '../pages/ReaderPage';

// A vertical (vertical-rl) book pages along its block axis, so in scrolled mode
// the strip only ever overflows horizontally. A mouse wheel reports a vertical
// delta, and no engine maps that onto a horizontal-only scroll range — so
// without the paginator translating the tick the book does not move at all
// under a wheel. (Touch panning still works: a drag carries both axes.)
//
// These assertions read the real scroll offset out of the paginator's
// scrollport rather than any flag, so they fail on the symptom a reader sees.
const VERTICAL_EPUB = process.env.READEST_VERTICAL_EPUB;
const hasVerticalBook = !!VERTICAL_EPUB && existsSync(VERTICAL_EPUB);

// The sample EPUB in the repo is horizontal; point READEST_VERTICAL_EPUB at a
// vertical book to run this lane.
test.skip(!hasVerticalBook, 'set READEST_VERTICAL_EPUB to a vertical (vertical-rl) EPUB');

type ScrollState = {
  left: number;
  room: number;
  dir: string | null;
  flow: string | null;
  vertical: boolean;
};

const readScroll = (page: Page) =>
  page.evaluate(() => {
    const view = document.querySelector('foliate-view') as
      | (HTMLElement & { renderer?: HTMLElement })
      | null;
    const renderer = view?.renderer;
    const container = renderer?.shadowRoot?.querySelector('#container') as HTMLElement | null;
    if (!renderer || !container) {
      return { left: 0, room: 0, dir: null, flow: null, vertical: false };
    }
    return {
      left: container.scrollLeft,
      room: container.scrollWidth - container.clientWidth,
      dir: renderer.getAttribute('dir'),
      flow: renderer.getAttribute('flow'),
      vertical: container.classList.contains('vertical'),
    };
  });

/** Import the vertical book, then switch the reader to scrolled mode. */
const openVerticalScrolled = async (openBook: (p?: string) => Promise<ReaderPage>) => {
  const reader = await openBook(VERTICAL_EPUB!);
  await reader.revealHeader();
  await reader.headerBar.locator('button[aria-label="View Options"]').click();
  await reader.page.locator('.view-menu').getByText('Scrolled Mode', { exact: true }).click();
  await reader.page.keyboard.press('Escape');

  await expect
    .poll(async () => (await readScroll(reader.page)).flow, { timeout: 30_000 })
    .toBe('scrolled');
  // The cover section of this book does not import the stylesheet that sets
  // `writing-mode: vertical-rl`, so the reader lays it out as a horizontal
  // page. Open a body chapter before measuring anything vertical.
  await reader.openTocChapter(3);

  // The strip needs somewhere to scroll for the assertions to mean anything;
  // that only holds once a vertical section is laid out.
  await expect
    .poll(async () => (await readScroll(reader.page)).room, { timeout: 30_000 })
    .toBeGreaterThan(200);
  return reader;
};

test('a wheel down scrolls a vertical scrolled book forward (leftward)', async ({ openBook }) => {
  const reader = await openVerticalScrolled(openBook);
  const before: ScrollState = await readScroll(reader.page);
  expect(before.vertical).toBe(true);
  // vertical-rl: the strip starts at scrollLeft 0 and reads into negatives.
  expect(before.dir).toBe('rtl');

  const box = await reader.viewer.boundingBox();
  expect(box).not.toBeNull();
  // Over the text itself, so the tick is dispatched inside the section iframe —
  // the case a host-level-only handler would miss entirely.
  await reader.page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await reader.page.mouse.wheel(0, 320);

  await expect
    .poll(async () => before.left - (await readScroll(reader.page)).left, { timeout: 5_000 })
    .toBeGreaterThan(100);

  // Wheel up walks back the same way.
  const after: ScrollState = await readScroll(reader.page);
  await reader.page.mouse.wheel(0, -320);
  await expect
    .poll(async () => (await readScroll(reader.page)).left - after.left, { timeout: 5_000 })
    .toBeGreaterThan(100);
});

test('the wheel moves the reading position, not just the pixels', async ({ openBook }) => {
  const reader = await openVerticalScrolled(openBook);
  const box = await reader.viewer.boundingBox();
  await reader.page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);

  // The first scroll after a chapter jump is swallowed on purpose — the
  // paginator keeps the anchor it was just given instead of re-deriving it from
  // a scroll it caused itself — so prime the position before measuring.
  await reader.page.mouse.wheel(0, 400);
  await reader.page.waitForTimeout(800);
  const before = await reader.readingProgress();

  // Several notches: the translation writes the offset directly, so this also
  // proves the resulting `scroll` event still drives relocate and the progress
  // readout instead of leaving the reader stuck on the old position.
  for (let i = 0; i < 4; i++) {
    await reader.page.mouse.wheel(0, 400);
    await reader.page.waitForTimeout(200);
  }

  await expect.poll(() => reader.readingProgress(), { timeout: 10_000 }).toBeGreaterThan(before);
});

test('a sideways pan is left to native scrolling', async ({ openBook }) => {
  const reader = await openVerticalScrolled(openBook);
  const before: ScrollState = await readScroll(reader.page);
  const box = await reader.viewer.boundingBox();
  await reader.page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  // The browser maps a horizontal-dominant pan onto the axis by itself; the
  // translation must stay out of the way or the book would move twice as far.
  await reader.page.mouse.wheel(240, 0);
  const panned: ScrollState = await readScroll(reader.page);
  expect(Math.abs(panned.left - before.left)).toBeGreaterThan(0);
  await reader.page.waitForTimeout(250);
  const settled: ScrollState = await readScroll(reader.page);
  expect(Math.abs(settled.left - panned.left)).toBeLessThan(2);
});

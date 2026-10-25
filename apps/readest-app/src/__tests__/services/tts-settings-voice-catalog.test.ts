import { describe, expect, it } from 'vitest';
import {
  EDGE_ENGINE,
  READEST_ENGINE,
  WEB_ENGINE,
  getEdgeVoices,
  getEngineGroups,
  pickVoice,
  usableVoices,
} from '@/services/tts/settingsVoiceCatalog';
import type { TTSVoicesGroup } from '@/services/tts/types';

// The settings panel lists voices without a reading session, so the catalog has
// to stand on the engines' static data alone.
describe('settings voice catalog', () => {
  it('lists only the requested language for Edge, without duplicates', () => {
    const voices = getEdgeVoices('zh');

    expect(voices.length).toBeGreaterThan(0);
    expect(voices.every((voice) => voice.lang.startsWith('zh'))).toBe(true);
    expect(new Set(voices.map((voice) => voice.id)).size).toBe(voices.length);
  });

  it('returns nothing for a language the engine does not speak', () => {
    expect(getEdgeVoices('xx')).toEqual([]);
  });

  it('keeps all three engines in a stable order, empty ones disabled', async () => {
    const groups = await getEngineGroups('zh', null);

    expect(groups.map((group) => group.id)).toEqual([READEST_ENGINE, EDGE_ENGINE, WEB_ENGINE]);
    // Readest Voice needs a catalog and a plan; Web needs system voices. Either
    // can be empty on a given device — the engine row must still be there.
    expect(groups.find((group) => group.id === WEB_ENGINE)?.voices).toEqual([]);
    expect(groups.find((group) => group.id === WEB_ENGINE)?.disabled).toBe(true);
  });

  describe('pickVoice', () => {
    const group: TTSVoicesGroup = {
      id: 'engine',
      name: 'Engine',
      voices: [
        { id: 'a', name: 'A', lang: 'zh' },
        { id: 'b', name: 'B', lang: 'zh', disabled: true },
        { id: 'c', name: 'C', lang: 'zh' },
      ],
    };

    it('keeps the remembered voice when it is playable', () => {
      expect(pickVoice(group, 'c')).toBe('c');
    });

    it('falls back to the first playable voice when the remembered one is locked', () => {
      expect(pickVoice(group, 'b')).toBe('a');
    });

    it('falls back to the first playable voice when nothing is remembered', () => {
      expect(pickVoice(group, '')).toBe('a');
    });

    it('returns nothing for a missing group', () => {
      expect(pickVoice(undefined, 'a')).toBeUndefined();
    });

    it('ignores disabled voices when counting what can play', () => {
      expect(usableVoices(group).map((voice) => voice.id)).toEqual(['a', 'c']);
    });
  });
});

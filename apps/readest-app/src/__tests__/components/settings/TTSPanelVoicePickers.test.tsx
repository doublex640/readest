import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ViewSettings } from '@/types/book';

const state = vi.hoisted(() => ({
  viewSettings: {
    ttsVoice: '',
    ttsHighlightOptions: { style: 'highlight', color: '#808080' },
  } as unknown as ViewSettings,
  setViewSettings: vi.fn(),
}));

// Fixed groups so the pickers' behaviour — not the catalog — is what is under
// test here.
vi.mock('@/services/tts/settingsVoiceCatalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/tts/settingsVoiceCatalog')>();
  const groups = [
    {
      id: 'readest-tts',
      name: 'Readest Voice',
      voices: [{ id: 'rv-aurora', name: 'Aurora', lang: 'zh' }],
    },
    {
      id: 'edge-tts',
      name: 'Edge TTS',
      voices: [
        { id: 'zh-CN-XiaoxiaoNeural', name: 'Xiaoxiao', lang: 'zh-CN' },
        { id: 'zh-CN-YunxiNeural', name: 'Yunxi', lang: 'zh-CN' },
        { id: 'zh-CN-XiaoyiNeural', name: 'Xiaoyi', lang: 'zh-CN', disabled: true },
      ],
    },
    { id: 'web-speech', name: 'Web TTS', voices: [] },
  ];
  return { ...actual, getEngineGroups: async () => groups };
});

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ token: null, user: null }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

vi.mock('@/utils/misc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/misc')>()),
  getLocale: () => 'zh-CN',
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {} }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    // Settings opened over a book has a key; from the library it has none.
    getViewSettings: (key: string) => (key ? state.viewSettings : null),
    setViewSettings: state.setViewSettings,
  }),
}));

vi.mock('@/store/settingsStore', () => {
  const store = {
    settings: {
      globalViewSettings: state.viewSettings,
      globalReadSettings: { customTtsHighlightColors: [] },
    },
    setSettings: vi.fn(),
    saveSettings: vi.fn(),
  };
  return { useSettingsStore: Object.assign(() => store, { getState: () => store }) };
});

vi.mock('@/hooks/useResetSettings', () => ({
  useResetViewSettings: () => vi.fn(),
}));

vi.mock('@/helpers/settings', () => ({
  saveViewSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/tts/providers/bookCacheStore', () => ({
  getTTSCacheConfig: () => ({ enabled: false, syncEnabled: false, budgetMB: 200 }),
  setTTSCacheConfig: vi.fn(),
}));

vi.mock('@/components/settings/theme/TTSHighlightStyleEditor', () => ({
  default: () => null,
}));

import TTSPanel from '@/components/settings/TTSPanel';
import { TTSUtils } from '@/services/tts/TTSUtils';

const engineTrigger = () => screen.getByLabelText('Speech Engine') as HTMLButtonElement;
const voiceTrigger = () => screen.getByLabelText('Speaker') as HTMLButtonElement;
const shown = (trigger: HTMLElement) => (trigger.textContent || '').trim();
const stored = () => JSON.parse(localStorage.getItem('ttsPreferredVoices') || '{}');

// The pickers paint their own list (a native popup ignores the app theme), so
// a choice is: open the trigger, then click the row.
const openMenu = (trigger: HTMLElement) => {
  fireEvent.click(trigger);
  return screen.getByRole('listbox');
};
const choose = (trigger: HTMLElement, label: string) => {
  openMenu(trigger);
  const option = screen.getByRole('option', { name: label });
  fireEvent.click(option.querySelector('button')!);
};

const renderPanel = async (bookKey = '') => {
  render(<TTSPanel bookKey={bookKey} onRegisterReset={vi.fn()} />);
  await waitFor(() => expect(shown(engineTrigger())).not.toBe(''));
};

describe('TTSPanel engine and speaker pickers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    state.viewSettings.ttsVoice = '';
  });

  afterEach(cleanup);

  it("lists the three engines and defaults to Edge, the reader's own default", async () => {
    await renderPanel();

    openMenu(engineTrigger());
    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.textContent?.trim())).toEqual([
      'Readest Voice',
      'Edge TTS',
      'Web TTS',
    ]);
    // An engine with no voices on this device cannot be picked.
    expect(screen.getByRole('option', { name: 'Web TTS' }).getAttribute('aria-disabled')).toBe(
      'true',
    );

    expect(shown(engineTrigger())).toBe('Edge TTS');
    expect(shown(voiceTrigger())).toBe('Xiaoxiao');
    // Showing what a reading session would pick is not the same as choosing it.
    expect(stored()).toEqual({});
  });

  it("shows only the chosen engine's voices", async () => {
    await renderPanel();

    choose(engineTrigger(), 'Readest Voice');

    expect(shown(voiceTrigger())).toBe('Aurora');
    openMenu(voiceTrigger());
    expect(screen.getAllByRole('option').map((option) => option.textContent?.trim())).toEqual([
      'Aurora',
    ]);
  });

  it('saves the engine and the voice in the store every engine reads back', async () => {
    await renderPanel();

    choose(engineTrigger(), 'Readest Voice');

    expect(stored()).toMatchObject({
      preferredClient: 'readest-tts',
      'readest-tts-zh': 'rv-aurora',
    });

    choose(engineTrigger(), 'Edge TTS');
    choose(voiceTrigger(), 'Yunxi');

    expect(stored()).toMatchObject({
      preferredClient: 'edge-tts',
      'edge-tts-zh': 'zh-CN-YunxiNeural',
    });
    expect(shown(voiceTrigger())).toBe('Yunxi');
  });

  it('ignores a locked voice', async () => {
    await renderPanel();

    openMenu(voiceTrigger());
    const locked = screen.getByRole('option', { name: 'Xiaoyi' });
    expect(locked.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(locked.querySelector('button')!);

    expect(shown(voiceTrigger())).toBe('Xiaoxiao');
    expect(stored()).toEqual({});
  });

  it('records the choice on the open book, like the reading page does', async () => {
    await renderPanel('book-1');

    choose(voiceTrigger(), 'Yunxi');

    expect(state.setViewSettings).toHaveBeenCalledWith(
      'book-1',
      expect.objectContaining({ ttsVoice: 'zh-CN-YunxiNeural' }),
    );
  });

  it('follows a voice picked elsewhere while the panel is open', async () => {
    await renderPanel();
    expect(shown(engineTrigger())).toBe('Edge TTS');

    await act(async () => {
      TTSUtils.setPreferredClient('readest-tts');
      TTSUtils.setPreferredVoice('readest-tts', 'zh-CN', 'rv-aurora');
    });

    await waitFor(() => expect(shown(engineTrigger())).toBe('Readest Voice'));
    expect(shown(voiceTrigger())).toBe('Aurora');
  });

  it('closes the menu on Escape', async () => {
    await renderPanel();

    openMenu(engineTrigger());
    fireEvent.keyDown(engineTrigger(), { key: 'Escape' });

    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

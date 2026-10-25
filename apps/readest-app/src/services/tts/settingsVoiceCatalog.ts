// Voice catalog for the Settings -> TTS -> Voices picker.
//
// The reader's own voice list comes from a live TTSController, which only
// exists while a book is open and reading has been started. The settings panel
// has neither, so it lists the same three engines from their static sources:
// - Edge TTS: the provider's built-in table (no init, no network);
// - Web TTS: the platform speech synthesis voices (empty until reported);
// - Readest Voice: the server catalog, voices the plan lacks greyed out.
//
// The ids below MUST match the clients' `name`s (`readest-tts`, `edge-tts`,
// `web-speech`): that is the key TTSUtils stores the preference under, and the
// key the readers themselves read back when they pick a voice.

import { getCatalog, offeredVoices } from '@/libs/readestVoice/catalog';
import { getSubscriptionPlan, isVoiceTierInPlan } from '@/utils/access';
import { isSameLang } from '@/utils/lang';
import { getUserLocale } from '@/utils/misc';
import { EdgeSpeechTTS } from '@/libs/edgeTTS';
import { WEB_SPEECH_BLACKLISTED_VOICES } from './TTSData';
import { TTSUtils } from './TTSUtils';
import { TTSVoice, TTSVoicesGroup } from './types';

export const READEST_ENGINE = 'readest-tts';
export const EDGE_ENGINE = 'edge-tts';
export const WEB_ENGINE = 'web-speech';

// Display order matches the voice picker in the reader: the premium engine
// first, the always-available one last.
export const ENGINE_ORDER = [READEST_ENGINE, EDGE_ENGINE, WEB_ENGINE] as const;

const ENGINE_LABELS: Record<string, string> = {
  [READEST_ENGINE]: 'Readest Voice',
  [EDGE_ENGINE]: 'Edge TTS',
  [WEB_ENGINE]: 'Web TTS',
};

export const engineLabel = (engineId: string): string => ENGINE_LABELS[engineId] || engineId;

// The voice list is scoped to one language: the book's when Settings was opened
// from a book, the interface's otherwise. Edge alone ships 300+ voices.
const sortForLang = (voices: TTSVoice[], lang: string): TTSVoice[] => {
  const locale = lang === 'en' ? getUserLocale(lang) || lang : lang;
  return voices.sort(TTSUtils.sortVoicesPreferLocaleFunc(locale));
};

const dedupeById = (voices: TTSVoice[]): TTSVoice[] => {
  const seen = new Set<string>();
  return voices.filter((voice) => {
    if (seen.has(voice.id)) return false;
    seen.add(voice.id);
    return true;
  });
};

export const getEdgeVoices = (lang: string): TTSVoice[] =>
  sortForLang(
    dedupeById(
      EdgeSpeechTTS.voices
        .filter((voice) => isSameLang(voice.lang, lang))
        .map((voice) => ({ ...voice })),
    ),
    lang,
  );

// Plan-gated exactly as the reader shows them: every voice some plan unlocks is
// listed, the ones this reader's plan lacks disabled.
export const getReadestVoices = async (lang: string, token: string | null): Promise<TTSVoice[]> => {
  const catalog = await getCatalog();
  if (!catalog) return [];
  const plan = getSubscriptionPlan(token || '');
  return sortForLang(
    dedupeById(
      offeredVoices(catalog)
        .filter((voice) => isSameLang(voice.lang, lang))
        .map((voice) => ({
          id: voice.id,
          name: voice.name,
          lang: voice.lang,
          tier: voice.tier,
          disabled: !token || !isVoiceTierInPlan(voice.tier, plan),
        })),
    ),
    lang,
  );
};

export const getWebVoices = (lang: string): TTSVoice[] => {
  if (typeof window === 'undefined' || !window.speechSynthesis) return [];
  const voices = window.speechSynthesis
    .getVoices()
    .filter((voice) => isSameLang(voice.lang, lang))
    .filter(
      (voice) =>
        !voice.voiceURI.startsWith('com.apple.eloquence.') &&
        !voice.voiceURI.startsWith('com.apple.speech.synthesis.voice.') &&
        !WEB_SPEECH_BLACKLISTED_VOICES.some((name) => voice.name.includes(name)),
    )
    .map(
      (voice) =>
        ({
          id: voice.voiceURI || voice.name,
          name: voice.name,
          lang: voice.lang,
        }) as TTSVoice,
    );
  return sortForLang(dedupeById(voices), lang);
};

// All three engines are always listed, in a stable order, even when one has
// nothing to offer (signed out, no system voices): a missing engine would read
// as "the app lost a feature", an empty one as "this device has nothing".
export const getEngineGroups = async (
  lang: string,
  token: string | null,
): Promise<TTSVoicesGroup[]> => {
  const [readest, edge, web] = await Promise.all([
    getReadestVoices(lang, token),
    Promise.resolve(getEdgeVoices(lang)),
    Promise.resolve(getWebVoices(lang)),
  ]);
  const byEngine: Record<string, TTSVoice[]> = {
    [READEST_ENGINE]: readest,
    [EDGE_ENGINE]: edge,
    [WEB_ENGINE]: web,
  };
  return ENGINE_ORDER.map((engineId) => {
    const voices = byEngine[engineId]!;
    return {
      id: engineId,
      name: ENGINE_LABELS[engineId]!,
      voices,
      disabled: voices.length === 0,
    };
  });
};

export const usableVoices = (group: TTSVoicesGroup | undefined): TTSVoice[] =>
  group ? group.voices.filter((voice) => !voice.disabled) : [];

// The voice to fall back on inside an engine: the one already remembered for
// this language, else the first the reader can actually play.
export const pickVoice = (
  group: TTSVoicesGroup | undefined,
  remembered: string,
): string | undefined => {
  if (!group) return undefined;
  const usable = usableVoices(group);
  if (usable.some((voice) => voice.id === remembered)) return remembered;
  if (group.voices.some((voice) => voice.id === remembered) && usable.length === 0) {
    return remembered;
  }
  return usable[0]?.id;
};

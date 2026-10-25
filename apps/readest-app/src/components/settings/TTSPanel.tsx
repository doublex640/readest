import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { isCustomTTSAllowed } from '@/utils/access';
import { navigateToLogin, navigateToProfile } from '@/utils/nav';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useResetViewSettings } from '@/hooks/useResetSettings';
import { useTranslation } from '@/hooks/useTranslation';
import { saveViewSettings } from '@/helpers/settings';
import { getLocale } from '@/utils/misc';
import { eventDispatcher } from '@/utils/event';
import { SettingsPanelPanelProp } from './SettingsDialog';
import {
  TTSHighlightGranularity,
  TTSMediaMetadataMode,
  TTSPlayerStyle,
  TTSVoicesGroup,
} from '@/services/tts/types';
import { TTSUtils } from '@/services/tts/TTSUtils';
import {
  EDGE_ENGINE,
  engineLabel,
  getEngineGroups,
  pickVoice,
  usableVoices,
} from '@/services/tts/settingsVoiceCatalog';
import { getTTSCacheConfig, setTTSCacheConfig } from '@/services/tts/providers/bookCacheStore';
import {
  BoxedList,
  NavigationRow,
  SettingsPicker,
  SettingsRow,
  SettingsSwitchRow,
} from './primitives';
import CustomTTSServices from './CustomTTSServices';
import TTSHighlightStyleEditor, { TTSHighlightStyle } from './theme/TTSHighlightStyleEditor';

const TTSPanel: React.FC<SettingsPanelPanelProp> = ({ bookKey, onRegisterReset }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const router = useAppRouter();
  const { token, user } = useAuth();
  const hasPremium = isCustomTTSAllowed(token);
  const [showCustomServices, setShowCustomServices] = useState(false);
  const { getViewSettings, setViewSettings } = useReaderStore();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const viewSettings = getViewSettings(bookKey) || settings.globalViewSettings;
  const showInlineReadings = ['ja', 'ko'].includes(getLocale().toLowerCase().split('-')[0]!);

  const [ttsMediaMetadata, setTtsMediaMetadata] = useState<TTSMediaMetadataMode>(
    viewSettings.ttsMediaMetadata ?? 'sentence',
  );
  const [ttsPlayerStyle, setTtsPlayerStyle] = useState<TTSPlayerStyle>(
    viewSettings.ttsPlayerStyle ?? 'full',
  );
  const [ttsHighlightGranularity, setTtsHighlightGranularity] = useState<TTSHighlightGranularity>(
    viewSettings.ttsHighlightGranularity ?? 'word',
  );
  const [ttsSkipInlineAnnotations, setTtsSkipInlineAnnotations] = useState(
    viewSettings.ttsSkipInlineAnnotations ?? false,
  );
  const [ttsHighlightStyle, setTtsHighlightStyle] = useState(
    viewSettings.ttsHighlightOptions.style,
  );
  const [ttsHighlightColor, setTtsHighlightColor] = useState(
    viewSettings.ttsHighlightOptions.color,
  );
  const [customTtsHighlightColors, setCustomTtsHighlightColors] = useState(
    settings.globalReadSettings.customTtsHighlightColors || [],
  );

  const [ttsCacheConfig, setTtsCacheConfigState] = useState(getTTSCacheConfig());

  const updateTTSCacheConfig = (config: typeof ttsCacheConfig) => {
    setTtsCacheConfigState(config);
    setTTSCacheConfig(config);
  };

  // ── Engine + voice ─────────────────────────────────────────────────────
  // The pair the reading page's voice picker also writes: TTSUtils keeps the
  // engine separately from the voice (per engine and language), and every
  // engine reads both back when a reading session starts. Sharing that store
  // is what keeps the two screens in step without either knowing the other.
  const [voiceGroups, setVoiceGroups] = useState<TTSVoicesGroup[]>([]);
  const [engineId, setEngineId] = useState('');
  const [voiceId, setVoiceId] = useState('');
  // Changes this panel makes are already on screen; echoing them back through
  // the preference event would only risk re-resolving them mid-interaction.
  const selfChangeRef = useRef(false);

  const getBookData = useBookDataStore((s) => s.getBookData);
  // Scope the voice list to one language: the book's when Settings was opened
  // over a book, the interface's otherwise.
  const voiceLang = useMemo(
    () => (bookKey ? getBookData(bookKey)?.book?.primaryLanguage : '') || getLocale(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookKey, getBookData],
  );

  const applyStoredSelection = useCallback(
    (groups: TTSVoicesGroup[]) => {
      if (groups.length === 0) return;
      const bookVoice = (bookKey && getViewSettings(bookKey)?.ttsVoice) || '';
      const storedEngine = TTSUtils.getPreferredClient() ?? '';
      const rememberedFor = (engine: string) =>
        TTSUtils.getPreferredVoice(engine, voiceLang) || bookVoice;
      // The voice in effect may belong to another engine than the stored key
      // names — the book carries its own value, and it may be older than the
      // preference. Whichever engine owns that voice is the one to show.
      const owner = groups.find((group) =>
        group.voices.some((voice) => voice.id === rememberedFor(storedEngine)),
      );
      const engine =
        groups.find((group) => group.id === storedEngine && usableVoices(group).length > 0)?.id ??
        owner?.id ??
        // Nothing remembered: show what a reading session would actually pick.
        // The reader falls back to Edge — Readest Voice is deliberately never
        // the default — so listing the first group here would lie to a reader
        // whose plan unlocks it.
        groups.find((group) => group.id === EDGE_ENGINE && usableVoices(group).length > 0)?.id ??
        groups.find((group) => usableVoices(group).length > 0)?.id ??
        groups[0]!.id;
      setEngineId(engine);
      setVoiceId(
        pickVoice(
          groups.find((group) => group.id === engine),
          rememberedFor(engine),
        ) ?? '',
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookKey, voiceLang],
  );

  useEffect(() => {
    let current = true;
    const load = async () => {
      const groups = await getEngineGroups(voiceLang, token);
      if (!current) return;
      setVoiceGroups(groups);
      applyStoredSelection(groups);
    };
    void load();
    // Chromium reports system voices late and asynchronously: the list is empty
    // at first paint and arrives with this event.
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    const onVoicesChanged = () => void load();
    synth?.addEventListener?.('voiceschanged', onVoicesChanged);
    return () => {
      current = false;
      synth?.removeEventListener?.('voiceschanged', onVoicesChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceLang, token]);

  // The reader's own picker (and any other entry point) writes the same
  // preferences: re-read them so this panel never shows a stale engine.
  useEffect(() => {
    const syncFromPreferences = () => {
      if (selfChangeRef.current) return;
      applyStoredSelection(voiceGroups);
    };
    eventDispatcher.on(TTSUtils.VOICE_CHANGED_EVENT, syncFromPreferences);
    return () => eventDispatcher.off(TTSUtils.VOICE_CHANGED_EVENT, syncFromPreferences);
  }, [applyStoredSelection, voiceGroups]);

  const persistSelection = (engine: string, voice: string) => {
    if (!engine) return;
    selfChangeRef.current = true;
    try {
      TTSUtils.setPreferredClient(engine);
      if (voice) TTSUtils.setPreferredVoice(engine, voiceLang, voice);
    } finally {
      selfChangeRef.current = false;
    }
    // Record it on the open book too, exactly as the reading page's picker
    // does, so the value the reader sees there is the value picked here.
    if (bookKey) {
      const vs = getViewSettings(bookKey);
      if (vs) {
        vs.ttsVoice = voice;
        setViewSettings?.(bookKey, vs);
      }
    }
  };

  const handleEngineChange = (engine: string) => {
    // Switching engines keeps the voice this reader last used for that engine,
    // instead of resetting it to the first one on every visit.
    const nextVoice =
      pickVoice(
        voiceGroups.find((group) => group.id === engine),
        TTSUtils.getPreferredVoice(engine, voiceLang) || '',
      ) ?? '';
    setEngineId(engine);
    setVoiceId(nextVoice);
    persistSelection(engine, nextVoice);
  };

  const handleVoiceChange = (voice: string) => {
    setVoiceId(voice);
    persistSelection(engineId, voice);
  };

  const activeGroup = voiceGroups.find((group) => group.id === engineId);
  const activeVoices = activeGroup?.voices ?? [];

  const resetToDefaults = useResetViewSettings();

  const handleReset = () => {
    resetToDefaults({
      ttsMediaMetadata: setTtsMediaMetadata as React.Dispatch<React.SetStateAction<string>>,
      ttsPlayerStyle: setTtsPlayerStyle as React.Dispatch<React.SetStateAction<string>>,
      ttsHighlightGranularity: setTtsHighlightGranularity as React.Dispatch<
        React.SetStateAction<string>
      >,
      ttsSkipInlineAnnotations: setTtsSkipInlineAnnotations,
    });
  };

  useEffect(() => {
    onRegisterReset(handleReset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ttsMediaMetadata === viewSettings.ttsMediaMetadata) return;
    saveViewSettings(envConfig, bookKey, 'ttsMediaMetadata', ttsMediaMetadata, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsMediaMetadata]);

  useEffect(() => {
    if (ttsPlayerStyle === viewSettings.ttsPlayerStyle) return;
    saveViewSettings(envConfig, bookKey, 'ttsPlayerStyle', ttsPlayerStyle, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsPlayerStyle]);

  useEffect(() => {
    if (ttsHighlightGranularity === viewSettings.ttsHighlightGranularity) return;
    saveViewSettings(
      envConfig,
      bookKey,
      'ttsHighlightGranularity',
      ttsHighlightGranularity,
      false,
      false,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsHighlightGranularity]);

  useEffect(() => {
    if (ttsSkipInlineAnnotations === viewSettings.ttsSkipInlineAnnotations) return;
    saveViewSettings(
      envConfig,
      bookKey,
      'ttsSkipInlineAnnotations',
      ttsSkipInlineAnnotations,
      false,
      false,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsSkipInlineAnnotations]);

  // Android Back / Esc steps back to this panel instead of closing Settings.
  useKeyDownActions({
    enabled: showCustomServices,
    onCancel: () => setShowCustomServices(false),
  });

  // Custom TTS services are premium: everyone else is routed to the plans page
  // (or sign-in) instead of the sub-page.
  const handleOpenCustomServices = () => {
    if (hasPremium) setShowCustomServices(true);
    else if (user) navigateToProfile(router);
    else navigateToLogin(router);
  };

  const handleTTSStyleChange = (style: TTSHighlightStyle) => {
    setTtsHighlightStyle(style);
    saveViewSettings(envConfig, bookKey, 'ttsHighlightOptions', {
      style,
      color: ttsHighlightColor,
    });
  };

  const handleTTSColorChange = (color: string) => {
    setTtsHighlightColor(color);
    saveViewSettings(envConfig, bookKey, 'ttsHighlightOptions', {
      style: ttsHighlightStyle,
      color,
    });
  };

  const handleCustomTtsColorsChange = (colors: string[]) => {
    setCustomTtsHighlightColors(colors);
    settings.globalReadSettings.customTtsHighlightColors = colors;
    setSettings(settings);
    saveSettings(envConfig, settings);
  };

  const handleMediaMetadataChange = (value: string) => {
    setTtsMediaMetadata(value as TTSMediaMetadataMode);
  };

  const handlePlayerStyleChange = (value: string) => {
    setTtsPlayerStyle(value as TTSPlayerStyle);
  };

  const handleTTSGranularityChange = (granularity: TTSHighlightGranularity) => {
    setTtsHighlightGranularity(granularity);
  };

  if (showCustomServices) {
    return (
      <div className='w-full'>
        <CustomTTSServices onBack={() => setShowCustomServices(false)} />
      </div>
    );
  }

  return (
    <div className='my-4 w-full space-y-6'>
      <BoxedList title={_('Voices')} cardClassName='overflow-hidden'>
        <SettingsRow label={_('Speech Engine')} data-setting-id='settings.tts.engine'>
          <SettingsPicker
            value={engineId}
            onChange={handleEngineChange}
            ariaLabel={_('Speech Engine')}
            disabled={voiceGroups.length === 0}
            options={voiceGroups.map((group) => ({
              value: group.id,
              label: _(engineLabel(group.id)),
              disabled: usableVoices(group).length === 0,
            }))}
          />
        </SettingsRow>
        <SettingsRow label={_('Speaker')} data-setting-id='settings.tts.voice'>
          <SettingsPicker
            value={voiceId}
            onChange={handleVoiceChange}
            ariaLabel={_('Speaker')}
            disabled={activeVoices.length === 0}
            options={
              activeVoices.length > 0
                ? activeVoices.map((voice) => ({
                    value: voice.id,
                    // Two Edge voices can share a name and differ only by the
                    // trait spelled into their id; keep that visible.
                    label: voice.variant
                      ? `${_(voice.name)} · ${voice.variant === 'multilingual' ? _('Multilingual') : _('Expressive')}`
                      : _(voice.name),
                    disabled: voice.disabled,
                  }))
                : [{ value: '', label: _('No voices available') }]
            }
          />
        </SettingsRow>
        <NavigationRow
          title={_('Custom TTS Services')}
          status={_('Use your own OpenAI-compatible speech service')}
          badge={hasPremium ? undefined : _('Premium')}
          onClick={handleOpenCustomServices}
          data-setting-id='settings.tts.customServices'
        />
      </BoxedList>

      <TTSHighlightStyleEditor
        granularity={ttsHighlightGranularity}
        style={ttsHighlightStyle}
        color={ttsHighlightColor}
        customColors={customTtsHighlightColors}
        onGranularityChange={handleTTSGranularityChange}
        onStyleChange={handleTTSStyleChange}
        onColorChange={handleTTSColorChange}
        onCustomColorsChange={handleCustomTtsColorsChange}
        data-setting-id='settings.tts.ttsHighlightStyle'
      />

      {showInlineReadings && (
        <BoxedList title={_('Speech')} data-setting-id='settings.tts.speech'>
          <SettingsSwitchRow
            label={_('Skip Parenthetical Readings')}
            description={_('Do not speak readings or Hanja glosses in parentheses after a word')}
            checked={ttsSkipInlineAnnotations}
            onChange={() => setTtsSkipInlineAnnotations(!ttsSkipInlineAnnotations)}
            data-setting-id='settings.tts.skipInlineAnnotations'
          />
        </BoxedList>
      )}

      <BoxedList title={_('Media Info')} data-setting-id='settings.tts.mediaMetadata'>
        <SettingsRow label={_('Player Style')} data-setting-id='settings.tts.playerStyle'>
          <SettingsPicker
            value={ttsPlayerStyle}
            onChange={handlePlayerStyleChange}
            ariaLabel={_('Player Style')}
            options={[
              { value: 'full', label: _('Full') },
              { value: 'minimal', label: _('Minimal') },
            ]}
          />
        </SettingsRow>
        <SettingsRow label={_('Update Frequency')}>
          <SettingsPicker
            value={ttsMediaMetadata}
            onChange={handleMediaMetadataChange}
            ariaLabel={_('Update Frequency')}
            options={[
              { value: 'sentence', label: _('Every Sentence') },
              { value: 'paragraph', label: _('Every Paragraph') },
              { value: 'chapter', label: _('Every Chapter') },
            ]}
          />
        </SettingsRow>
      </BoxedList>

      <BoxedList title={_('Audio Cache')} data-setting-id='settings.tts.audioCache'>
        <SettingsSwitchRow
          label={_('Cache Synthesized Audio')}
          description={_('Reuse generated speech across sessions without refetching')}
          checked={ttsCacheConfig.enabled}
          onChange={() =>
            updateTTSCacheConfig({ ...ttsCacheConfig, enabled: !ttsCacheConfig.enabled })
          }
          data-setting-id='settings.tts.audioCacheEnabled'
        />
        <SettingsSwitchRow
          label={_('Sync Audio Cache')}
          description={_('Share section audio between your devices through your file sync service')}
          checked={ttsCacheConfig.syncEnabled}
          disabled={!ttsCacheConfig.enabled}
          onChange={() =>
            updateTTSCacheConfig({ ...ttsCacheConfig, syncEnabled: !ttsCacheConfig.syncEnabled })
          }
          data-setting-id='settings.tts.audioCacheSync'
        />
        <SettingsRow label={_('Storage Limit')}>
          <SettingsPicker
            value={String(ttsCacheConfig.budgetMB)}
            onChange={(value) =>
              updateTTSCacheConfig({
                ...ttsCacheConfig,
                budgetMB: Number(value),
              })
            }
            ariaLabel={_('Storage Limit')}
            disabled={!ttsCacheConfig.enabled}
            options={[
              { value: '50', label: '50 MB' },
              { value: '100', label: '100 MB' },
              { value: '200', label: '200 MB' },
              { value: '500', label: '500 MB' },
              { value: '1024', label: '1 GB' },
            ]}
          />
        </SettingsRow>
      </BoxedList>
    </div>
  );
};

export default TTSPanel;

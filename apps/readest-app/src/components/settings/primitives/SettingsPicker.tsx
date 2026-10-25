import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MdArrowDropDown, MdCheck } from 'react-icons/md';

export interface SettingsPickerOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SettingsPickerProps {
  value: string;
  options: SettingsPickerOption[];
  onChange: (value: string) => void;
  /** Names the trigger and the list, and what tests/command palette look up. */
  ariaLabel: string;
  disabled?: boolean;
}

const MENU_GAP = 4;
const MENU_EDGE = 12;
// A row is ~34px (text-sm, py-1.5); the menu adds its own padding.
const ROW_HEIGHT = 34;
const MENU_MAX_HEIGHT = 320;

/**
 * Trailing-edge picker for a boxed-list row: the same footprint as
 * `<SettingsSelect>`, but the list is painted by the page instead of the
 * platform.
 *
 * A native `<select>` only looks like the rest of the app where the browser
 * honours `appearance: base-select` (Chromium 135+): older engines fall back to
 * the OS popup, which ignores the app theme entirely — a white list on a dark
 * panel. This renders the menu itself, styled after the font picker and the
 * app's other menus: base-200 card, a check on the current entry, entries the
 * reader cannot use greyed but listed.
 */
const SettingsPicker: React.FC<SettingsPickerProps> = ({
  value,
  options,
  onChange,
  ariaLabel,
  disabled,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [menuBox, setMenuBox] = useState<{ top: number; right: number; maxHeight: number } | null>(
    null,
  );
  const [menuHost, setMenuHost] = useState<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLUListElement | null>(null);

  const selected = options.find((option) => option.value === value) ?? options[0];

  const close = useCallback((returnFocus = false) => {
    setIsOpen(false);
    setMenuBox(null);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // The menu hangs past its row — an engine's voice list is taller than the
  // card it belongs to, and the card clips its overflow. It is therefore
  // mounted on the settings dialog itself rather than in the row: inside the
  // dialog it stays in the modal's top layer (a portal to <body> would render
  // behind the backdrop), while the row's clipping card is out of the way.
  // Dialog coordinates are viewport coordinates, so the placement below is the
  // trigger's own rect.
  useEffect(() => {
    const dialog = triggerRef.current?.closest('dialog');
    setMenuHost(dialog ?? document.body);
  }, []);

  const placeMenu = useCallback(() => {
    const trigger = triggerRef.current;
    const host = menuHost;
    if (!trigger || !host) return;
    const rect = trigger.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const boundary =
      hostRect.height > 0 ? hostRect : ({ top: 0, bottom: window.innerHeight } as DOMRect);
    const wanted = Math.min(options.length * ROW_HEIGHT + 8, MENU_MAX_HEIGHT);
    const below = boundary.bottom - rect.bottom - MENU_GAP - MENU_EDGE;
    const above = rect.top - boundary.top - MENU_GAP - MENU_EDGE;
    // Open upwards when that is the only side with room for more of the list.
    const openUp = below < wanted && above > below;
    const maxHeight = Math.max(120, Math.min(wanted, openUp ? above : below));
    setMenuBox({
      top: openUp ? rect.top - maxHeight - MENU_GAP : rect.bottom + MENU_GAP,
      right: Math.max(MENU_EDGE, window.innerWidth - rect.right),
      maxHeight,
    });
  }, [menuHost, options.length]);

  useEffect(() => {
    if (!isOpen) return;
    placeMenu();
    // The panel scrolls under the open menu; keep it glued to its row.
    const onViewportChange = () => placeMenu();
    window.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('resize', onViewportChange);
    return () => {
      window.removeEventListener('scroll', onViewportChange, true);
      window.removeEventListener('resize', onViewportChange);
    };
  }, [isOpen, placeMenu]);

  // A click anywhere else dismisses the menu. The menu lives outside the row,
  // so it has to be part of "inside".
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [isOpen, close]);

  // Escape closes the menu, not the settings dialog behind it. The dialog is a
  // native <dialog>, whose Escape-to-dismiss cannot be stopped from a bubbling
  // handler — and the app's own Escape handler runs on window — so claim the key
  // in the capture phase and cancel the default dismissal.
  useEffect(() => {
    if (!isOpen) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    };
    document.addEventListener('keydown', onEscape, true);
    return () => document.removeEventListener('keydown', onEscape, true);
  }, [isOpen, close]);

  const handleSelect = (option: SettingsPickerOption) => {
    if (option.disabled) return;
    close(true);
    if (option.value !== value) onChange(option.value);
  };

  const menu =
    isOpen && menuBox ? (
      <ul
        ref={menuRef}
        role='listbox'
        aria-label={`${ariaLabel} options`}
        style={{ top: menuBox.top, right: menuBox.right, maxHeight: menuBox.maxHeight }}
        className={clsx(
          'bg-base-200 border-base-300 fixed z-50',
          'rounded-box w-max min-w-40 max-w-[min(88vw,22rem)] overflow-y-auto border p-1 shadow-lg',
        )}
      >
        {options.map((option) => {
          const isSelected = option.value === value;
          return (
            <li
              key={option.value}
              role='option'
              aria-selected={isSelected}
              aria-disabled={option.disabled || undefined}
            >
              <button
                type='button'
                disabled={option.disabled}
                onClick={() => handleSelect(option)}
                className={clsx(
                  'flex w-full items-center gap-x-2 rounded-md px-2 py-1.5 text-start text-sm',
                  option.disabled ? 'text-base-content/40 cursor-default' : 'hover:bg-base-300/60',
                  isSelected && 'font-medium',
                )}
              >
                <span className='w-4 shrink-0'>
                  {isSelected && <MdCheck size={16} className='text-base-content' />}
                </span>
                <span className='ps-1'>{option.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    ) : null;

  return (
    <div ref={rootRef} className='relative flex max-w-[60%] min-w-0 items-center'>
      <button
        ref={triggerRef}
        type='button'
        aria-label={ariaLabel}
        aria-haspopup='listbox'
        aria-expanded={isOpen}
        disabled={disabled}
        onClick={() => setIsOpen((open) => !open)}
        className={clsx(
          'flex h-9 min-w-0 max-w-full items-center gap-x-1 rounded-md ps-2 pe-1',
          'hover:bg-base-200/60 focus-visible:bg-base-200/60 disabled:opacity-50',
        )}
      >
        <span className='text-base-content truncate'>{selected?.label ?? ''}</span>
        <MdArrowDropDown
          aria-hidden='true'
          className={clsx(
            'text-base-content/55 h-5 w-5 shrink-0 transition-transform',
            isOpen && 'rotate-180',
          )}
        />
      </button>
      {menu && menuHost && createPortal(menu, menuHost)}
    </div>
  );
};

export default SettingsPicker;

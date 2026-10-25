import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import Section from "../components/Section";
import Toggle, { type Tone } from "../components/Toggle";
import { ChevronDown } from "../components/icons";
import type { Status } from "../components/StatusDot";
import { useToast } from "../components/Toast";
import { useStore } from "../state/store";
import { useT } from "../i18n";
import { MUSIC_KITS } from "../data/musicKits";
import { MUSIC_KIT_OFF, MUSIC_KIT_RANDOM, type PlayerCosmetics } from "../lib/api";
import "./CosmeticsSection.css";

const KITS_BY_NAME = [...MUSIC_KITS].sort((a, b) => a.name.localeCompare(b.name, "en"));

export default function CosmeticsSection() {
  const { cosmetics, cosmeticsUnsupported, cosmeticsPending, csgoPath, applyCosmetics } =
    useStore();
  const t = useT();
  const toast = useToast();

  const cfgPresent = cosmetics?.cfg_present ?? false;
  const running = cosmetics?.cs2_running ?? false;
  const yellow = running && cosmeticsPending;
  const disabled = !csgoPath || cosmeticsUnsupported || !cfgPresent;

  const status: Status =
    !csgoPath || cosmeticsUnsupported ? "off" : !cfgPresent ? "red" : yellow ? "yellow" : "green";
  const tone: Tone = !cfgPresent ? "red" : yellow ? "yellow" : "green";

  const current: PlayerCosmetics = {
    dropped_knife_skins: cosmetics?.dropped_knife_skins ?? false,
    dropped_knife_premium: cosmetics?.dropped_knife_premium ?? false,
    music_kit: cosmetics?.music_kit ?? MUSIC_KIT_OFF,
  };

  const kitLabel = (id: number) =>
    id === MUSIC_KIT_OFF
      ? t("cos.musicOff")
      : id === MUSIC_KIT_RANDOM
      ? t("cos.musicRandom")
      : MUSIC_KITS.find((k) => k.id === id)?.name ?? `#${id}`;

  // The plugin reads these convars when the cfg runs on map load, so a change
  // made while CS2 is running waits for the next map (same toast as Difficulty).
  const save = async (patch: Partial<PlayerCosmetics>, doneText?: string) => {
    const info = await applyCosmetics(patch);
    if (!info) return;
    if (info.cs2_running) toast.show(t("cos.nextMap"), "neutral");
    else if (doneText) toast.show(doneText, "green");
  };

  // Premium only changes how dropped-knife finishes are rolled.
  const premiumDisabled = disabled || !current.dropped_knife_skins;

  return (
    <Section title={t("cos.title")} status={status}>
      {cosmeticsUnsupported && <p className="cos__note">{t("cos.unsupported")}</p>}

      <div className="cos__row">
        <span className={`cos__text ${disabled ? "is-disabled" : ""}`}>
          <span className="cos__label">{t("cos.knifeSkins")}</span>
          <span className="cos__hint">{t("cos.knifeSkinsHint")}</span>
        </span>
        <Toggle
          ariaLabel={t("cos.knifeSkins")}
          checked={current.dropped_knife_skins}
          tone={tone}
          disabled={disabled}
          onChange={(on) => save({ dropped_knife_skins: on })}
        />
      </div>

      <div className="cos__row">
        <span className={`cos__text ${premiumDisabled ? "is-disabled" : ""}`}>
          <span className="cos__label">{t("cos.premium")}</span>
          <span className="cos__hint">{t("cos.premiumHint")}</span>
        </span>
        <Toggle
          ariaLabel={t("cos.premium")}
          checked={current.dropped_knife_premium}
          tone={tone}
          disabled={premiumDisabled}
          onChange={(on) => save({ dropped_knife_premium: on })}
        />
      </div>

      <div className="cos__divider" aria-hidden />

      <MusicKitPicker
        value={current.music_kit}
        label={kitLabel(current.music_kit)}
        disabled={disabled}
        onPick={(id) =>
          save({ music_kit: id }, `${t("cos.music")}: ${kitLabel(id)}`)
        }
      />
    </Section>
  );
}

type Option = { value: number; label: string };

type PickerProps = {
  value: number;
  label: string;
  disabled: boolean;
  onPick: (id: number) => void;
};

/** Searchable single-select. It expands inline instead of floating so it is
 *  never clipped at the bottom of the scrolling Presets page. */
function MusicKitPicker({ value, label, disabled, onPick }: PickerProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  // Opened from the keyboard: show the panel at once, with no entrance motion.
  const [instant, setInstant] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();
  const labelId = `${id}-label`;
  const listId = `${id}-list`;
  const panelId = `${id}-panel`;
  const optionId = (i: number) => `${id}-opt-${i}`;

  const q = query.trim().toLowerCase();
  const kits: Option[] = KITS_BY_NAME.filter(
    (k) => !q || k.name.toLowerCase().includes(q) || String(k.id) === q
  ).map((k) => ({ value: k.id, label: k.name }));
  // Off and Random stay pinned above the kits until the user starts typing.
  const pinned: Option[] = q
    ? []
    : [
        { value: MUSIC_KIT_OFF, label: t("cos.musicOff") },
        { value: MUSIC_KIT_RANDOM, label: t("cos.musicRandom") },
      ];
  const options = [...pinned, ...kits];

  const openPicker = (fromKeyboard: boolean) => {
    if (disabled) return;
    setInstant(fromKeyboard);
    const all = [MUSIC_KIT_OFF, MUSIC_KIT_RANDOM, ...KITS_BY_NAME.map((k) => k.id)];
    setQuery("");
    setActive(Math.max(all.indexOf(value), 0));
    setOpen(true);
  };

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const pick = (option: Option) => {
    close(true);
    if (option.value !== value) onPick(option.value);
  };

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  // On open: focus the search box, bring the panel into view (the section sits
  // at the bottom of the page) and centre the current choice in the list.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    panelRef.current?.scrollIntoView({
      block: "nearest",
      behavior: reduce || instant ? "auto" : "smooth",
    });
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (list && el) list.scrollTop = el.offsetTop - (list.clientHeight - el.offsetHeight) / 2;
    // Only on open; keyboard moves are handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep the keyboard-active option visible without scrolling the page.
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!list || !el) return;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [active]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const option = options[active];
      if (option) pick(option);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div className="cos-kit" ref={rootRef}>
      <span className={`cos__label ${disabled ? "is-disabled" : ""}`} id={labelId}>
        {t("cos.music")}
      </span>
      <button
        ref={triggerRef}
        type="button"
        className="cos-kit__btn"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-labelledby={`${labelId} ${id}-value`}
        // detail is 0 when Enter or Space activated the button.
        onClick={(e) => (open ? close(false) : openPicker(e.detail === 0))}
      >
        <span className="cos-kit__value" id={`${id}-value`}>
          {label}
        </span>
        <ChevronDown
          size={16}
          className={`cos-kit__chev ${open ? "is-open" : ""} ${instant ? "is-instant" : ""}`}
        />
      </button>

      {open && (
        <div
          className={`cos-kit__panel ${instant ? "is-instant" : ""}`}
          id={panelId}
          ref={panelRef}
        >
          <input
            ref={inputRef}
            className="cos-kit__search"
            type="text"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-labelledby={labelId}
            aria-activedescendant={options[active] ? optionId(active) : undefined}
            placeholder={t("cmd.search")}
            value={query}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <ul
            ref={listRef}
            className="cos-kit__list"
            id={listId}
            role="listbox"
            aria-labelledby={labelId}
          >
            {options.map((o, i) => (
              <li
                key={o.value}
                id={optionId(i)}
                data-index={i}
                role="option"
                aria-selected={o.value === value}
                className={[
                  "cos-kit__opt",
                  o.value === value && "is-selected",
                  i === active && "is-active",
                  pinned.length > 0 && i === pinned.length - 1 && "cos-kit__opt--pin-end",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onMouseMove={() => i !== active && setActive(i)}
                // Keep focus in the search box so the click lands as a pick.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(o)}
              >
                <span className="cos-kit__name">{o.label}</span>
                {o.value > 0 && <span className="cos-kit__id">{o.value}</span>}
              </li>
            ))}
          </ul>
          {options.length === 0 && (
            <p className="cos-kit__empty" role="status">
              {t("cos.noMatch")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

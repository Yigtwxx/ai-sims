'use client';

import { animate, cubicBezier, stagger, type JSAnimation } from 'animejs';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { DURATION, EASE, ms, prefersReducedMotion } from '@/components/motion/tokens';
import { SplitText } from '@/components/reactbits/SplitText';
import { cn } from '@/lib/utils';

import {
  CATEGORIES,
  FABRIC_COLORS,
  FACE_PRESETS,
  HAIR_COLORS,
  HAIR_PATTERNS,
  HAIR_STYLES,
  IRIS_COLORS,
  JEWELRY_ITEMS,
  PREVIEW_LIGHT,
  SKIN_TONES,
  WARDROBE_ITEMS,
  type Category,
} from './options';

/**
 * Customization preview: a category index on the left (a real tablist) and a
 * board of the options in that category on the right. Switching category
 * re-deals the board with an anime.js stagger (a ripple from the centre for
 * swatch grids). Selections are local: this is a preview of the creator.
 */
export function CustomizeSection() {
  const t = useTranslations('Landing.customize');
  const baseId = useId();
  const [category, setCategory] = useState<Category>('skin');
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const focusTab = (index: number) => {
    const next = CATEGORIES[(index + CATEGORIES.length) % CATEGORIES.length];
    setCategory(next);
    tabs.current[CATEGORIES.indexOf(next)]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const keys: Record<string, number> = {
      ArrowDown: index + 1,
      ArrowRight: index + 1,
      ArrowUp: index - 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: CATEGORIES.length - 1,
    };
    const target = keys[event.key];
    if (target === undefined) return;
    event.preventDefault();
    focusTab(target);
  };

  return (
    <section aria-labelledby="customize-title" className="py-section lg:pb-16">
      <div className="mx-auto max-w-[1440px] px-5 md:px-8 lg:px-12">
        <SplitText
          as="h2"
          id="customize-title"
          text={t('title')}
          className="font-headline text-headline text-ink max-w-[18ch]"
        />
        <p className="text-lede text-ink-muted mt-5 max-w-[46ch]">{t('lede')}</p>

        <div className="mt-14 grid gap-8 lg:mt-20 lg:grid-cols-12 lg:gap-12">
          <div
            role="tablist"
            aria-label={t('categoriesLabel')}
            aria-orientation="vertical"
            className="-mx-5 flex scrollbar-none gap-1 overflow-x-auto px-5 lg:col-span-4 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0"
          >
            {CATEGORIES.map((key, index) => {
              const selected = key === category;
              return (
                <button
                  key={key}
                  ref={(node) => {
                    tabs.current[index] = node;
                  }}
                  type="button"
                  role="tab"
                  id={`${baseId}-tab-${key}`}
                  aria-selected={selected}
                  aria-controls={`${baseId}-panel`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setCategory(key)}
                  onKeyDown={(event) => onKeyDown(event, index)}
                  className={cn(
                    'group rounded-tile relative flex shrink-0 items-center gap-4 px-4 py-3 text-left transition-colors duration-300 lg:px-0 lg:py-4',
                    selected ? 'text-ink' : 'text-ink-faint hover:text-ink-muted',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'bg-marquee ease-out-expo hidden h-px w-8 origin-left transition-transform duration-500 lg:block',
                      selected
                        ? 'scale-x-100'
                        : 'group-hover:bg-hairline scale-x-0 group-hover:scale-x-50',
                    )}
                  />
                  <span className="font-headline text-subhead whitespace-nowrap">
                    {t(`categories.${key}.label`)}
                  </span>
                </button>
              );
            })}
          </div>

          <div
            role="tabpanel"
            id={`${baseId}-panel`}
            aria-labelledby={`${baseId}-tab-${category}`}
            className="rounded-tile border-hairline bg-backstage-raised/60 relative flex flex-col overflow-hidden border p-6 md:p-10 lg:col-span-8 lg:min-h-[440px]"
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_80%_at_85%_0%,rgb(255_226_176/0.07),transparent_70%)]"
            />
            <p className="text-body text-ink-muted relative">{t(`categories.${category}.hint`)}</p>
            <Board key={category} category={category} />
          </div>
        </div>
      </div>
    </section>
  );
}

/** Deals the options of one category with a stagger when it mounts. */
function Board({ category }: { category: Category }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el || prefersReducedMotion()) return undefined;
    const animations: JSAnimation[] = [];
    el.querySelectorAll<HTMLElement>('[data-deal]').forEach((group) => {
      const items = group.querySelectorAll<HTMLElement>('[data-option]');
      const columns = Number(group.dataset.columns ?? 0);
      animations.push(
        animate(items, {
          opacity: [0, 1],
          y: [14, 0],
          scale: [0.94, 1],
          duration: ms(DURATION.slow),
          ease: cubicBezier(...EASE.outExpo),
          delay:
            columns > 0
              ? stagger(34, {
                  grid: [columns, Math.ceil(items.length / columns)],
                  from: 'center',
                })
              : stagger(30),
        }),
      );
    });
    el.querySelectorAll<HTMLElement>('[data-preview]').forEach((preview) => {
      animations.push(
        animate(preview, {
          opacity: [0, 1],
          scale: [0.92, 1],
          duration: ms(DURATION.cinematic),
          ease: cubicBezier(...EASE.outExpo),
        }),
      );
    });
    return () => animations.forEach((animation) => animation.revert());
  }, []);

  return (
    <div ref={root} className="relative mt-8 flex flex-1 flex-col justify-center">
      {category === 'face' ? <FaceBoard /> : null}
      {category === 'skin' ? <SkinBoard /> : null}
      {category === 'eyes' ? <EyesBoard /> : null}
      {category === 'hair' ? <HairBoard /> : null}
      {category === 'wardrobe' ? <WardrobeBoard /> : null}
      {category === 'jewelry' ? <JewelryBoard /> : null}
    </div>
  );
}

/** Options on the left, a large lit preview of the current choice on the right. */
function BoardLayout({ options, preview }: { options: ReactNode; preview: ReactNode }) {
  return (
    <div className="grid items-center gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
      <div className="flex flex-col gap-8">{options}</div>
      <div data-preview="" className="flex flex-col items-center justify-center">
        {preview}
      </div>
    </div>
  );
}

function GroupLabel({ children }: { children: ReactNode }) {
  return <p className="text-label text-ink-faint mb-3">{children}</p>;
}

function PreviewCaption({ children }: { children: ReactNode }) {
  return (
    <p className="text-title text-ink mt-6 text-center" aria-live="polite">
      {children}
    </p>
  );
}

/** A soft pool of stage light on the floor under a preview object. */
function FloorShadow() {
  return (
    <div
      aria-hidden="true"
      className="mt-2 h-5 w-36 bg-[radial-gradient(closest-side,rgb(11_11_10/0.75),transparent)]"
    />
  );
}

function FaceBoard() {
  const t = useTranslations('Landing.customize.categories.face');
  const [blend, setBlend] = useState(62);
  const [left, right] = FACE_PRESETS;
  const value = { left: blend, right: 100 - blend, leftName: left, rightName: right };

  return (
    <div className="flex flex-col gap-8">
      <div data-deal="" className="grid grid-cols-2 gap-4 sm:max-w-lg">
        {FACE_PRESETS.map((name, index) => {
          const weight = index === 0 ? blend : 100 - blend;
          return (
            <div
              key={name}
              data-option=""
              className="rounded-tile bg-backstage-deep relative aspect-[3/4] overflow-hidden"
            >
              <div
                aria-hidden="true"
                className="absolute inset-0 transition-opacity duration-300"
                style={{
                  opacity: 0.2 + (weight / 100) * 0.8,
                  background:
                    'radial-gradient(70% 55% at 50% 34%, rgb(255 226 176 / 0.2), transparent 70%)',
                }}
              />
              <p className="font-display text-subhead text-ink absolute bottom-4 left-4">{name}</p>
              <p className="text-label text-ink-muted absolute top-4 right-4 tabular-nums">
                {t('weight', { value: weight })}
              </p>
            </div>
          );
        })}
      </div>
      <div className="sm:max-w-lg">
        <label htmlFor="face-blend" className="text-label text-ink-faint">
          {t('blendLabel')}
        </label>
        <input
          id="face-blend"
          type="range"
          min={0}
          max={100}
          value={blend}
          onChange={(event) => setBlend(Number(event.target.value))}
          aria-valuetext={t('blendValue', value)}
          className="bg-hairline accent-marquee [&::-moz-range-thumb]:bg-marquee [&::-webkit-slider-thumb]:bg-marquee mt-3 h-1 w-full cursor-pointer appearance-none rounded-full [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full"
        />
        <p className="text-ui text-ink-muted mt-3 tabular-nums">{t('blendValue', value)}</p>
      </div>
    </div>
  );
}

function SwatchButton({
  color,
  label,
  selected,
  onSelect,
  iris = false,
}: {
  color: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
  iris?: boolean;
}) {
  return (
    <button
      type="button"
      data-option=""
      aria-pressed={selected}
      aria-label={label}
      title={label}
      onClick={onSelect}
      className={cn(
        'ring-offset-backstage-raised relative size-10 rounded-full ring-offset-[3px] transition-[box-shadow,transform] duration-200 hover:scale-105 sm:size-11 md:size-12 md:ring-offset-4',
        selected ? 'ring-marquee ring-2' : 'ring-hairline ring-1',
      )}
      style={{ background: iris ? irisBackground(color) : color }}
    />
  );
}

/** A small iris: pupil, coloured stroma with radial fibres, dark limbal ring. */
function irisBackground(color: string): string {
  return [
    `radial-gradient(circle, ${PREVIEW_LIGHT.pupil} 0 21%, transparent 23%)`,
    `repeating-conic-gradient(from 0deg, ${PREVIEW_LIGHT.fibre} 0deg 2deg, transparent 2deg 5deg)`,
    `radial-gradient(circle, color-mix(in oklab, ${color} 70%, ${PREVIEW_LIGHT.collarette}) 24%, ${color} 44%, color-mix(in oklab, ${color} 70%, black) 62%, ${PREVIEW_LIGHT.limbus} 70%)`,
  ].join(', ');
}

function SkinBoard() {
  const t = useTranslations('Landing.customize.categories.skin');
  const [selected, setSelected] = useState(4);
  const tone = SKIN_TONES[selected];

  return (
    <BoardLayout
      options={
        <div
          data-deal=""
          data-columns="6"
          className="grid w-fit grid-cols-6 gap-2.5 sm:gap-3 md:gap-4"
        >
          {SKIN_TONES.map((hex, index) => (
            <SwatchButton
              key={hex}
              color={hex}
              label={t('tone', { n: index + 1 })}
              selected={index === selected}
              onSelect={() => setSelected(index)}
            />
          ))}
        </div>
      }
      preview={
        <>
          {/* A lit sphere: key light top-left, warm subsurface in the shadow side. */}
          <div
            aria-hidden="true"
            className="size-40 rounded-full transition-[background] duration-500 md:size-48"
            style={{
              background: `radial-gradient(circle at 34% 28%, color-mix(in oklab, ${tone} 62%, ${PREVIEW_LIGHT.key}) 0%, ${tone} 36%, color-mix(in oklab, ${tone} 72%, ${PREVIEW_LIGHT.subsurface}) 74%, color-mix(in oklab, ${tone} 30%, ${PREVIEW_LIGHT.shadow}) 100%)`,
              boxShadow: `inset -14px -18px 36px ${PREVIEW_LIGHT.subsurfaceRim}`,
            }}
          />
          <FloorShadow />
          <PreviewCaption>{t('tone', { n: selected + 1 })}</PreviewCaption>
        </>
      }
    />
  );
}

function EyesBoard() {
  const t = useTranslations('Landing.customize.categories.eyes');
  const [selected, setSelected] = useState<(typeof IRIS_COLORS)[number]['key']>('hazel');
  const current = IRIS_COLORS.find((iris) => iris.key === selected) ?? IRIS_COLORS[0];

  return (
    <BoardLayout
      options={
        <div data-deal="" data-columns="4" className="grid w-fit grid-cols-4 gap-3 md:gap-4">
          {IRIS_COLORS.map((iris) => (
            <SwatchButton
              key={iris.key}
              iris
              color={iris.hex}
              label={t(`colors.${iris.key}`)}
              selected={iris.key === selected}
              onSelect={() => setSelected(iris.key)}
            />
          ))}
        </div>
      }
      preview={
        <>
          <div
            aria-hidden="true"
            className="relative size-40 rounded-full md:size-48"
            style={{ background: irisBackground(current.hex) }}
          >
            {/* Softbox catchlight on the cornea. */}
            <span className="rounded-tile bg-ink/80 absolute top-[24%] left-[27%] h-[13%] w-[17%] blur-[1px]" />
          </div>
          <PreviewCaption>{t(`colors.${selected}`)}</PreviewCaption>
        </>
      }
    />
  );
}

type HairColorKey = (typeof HAIR_COLORS)[number]['key'];
type HairPattern = (typeof HAIR_PATTERNS)[number];

/** Strand texture plus the dye pattern, painted with gradients over the base colour. */
function hairBackground(color: string, pattern: HairPattern): string {
  const strands = `repeating-linear-gradient(96deg, ${PREVIEW_LIGHT.fibre} 0 1px, transparent 1px 4px, ${PREVIEW_LIGHT.strandShade} 4px 5px, transparent 5px 9px)`;
  const light = `color-mix(in oklab, ${color} 45%, ${PREVIEW_LIGHT.bleach})`;
  const dark = `color-mix(in oklab, ${color} 55%, ${PREVIEW_LIGHT.shadow})`;
  const dye: Record<HairPattern, string> = {
    ombre: `linear-gradient(to bottom, ${color} 30%, ${light} 100%)`,
    roots: `linear-gradient(to bottom, ${dark} 0%, ${dark} 18%, ${color} 42%)`,
    highlights: `repeating-linear-gradient(94deg, transparent 0 14px, ${light} 14px 19px, transparent 19px 30px), linear-gradient(${color}, ${color})`,
    underlayer: `linear-gradient(to bottom, ${color} 55%, color-mix(in oklab, ${color} 40%, ${PREVIEW_LIGHT.underlayerDye}) 62%)`,
  };
  return `${strands}, linear-gradient(100deg, ${PREVIEW_LIGHT.sheen}, transparent 40%), ${dye[pattern]}`;
}

function HairBoard() {
  const t = useTranslations('Landing.customize.categories.hair');
  const [color, setColor] = useState<HairColorKey>('chestnut');
  const [pattern, setPattern] = useState<HairPattern>('ombre');
  const hex = HAIR_COLORS.find((hair) => hair.key === color)?.hex ?? HAIR_COLORS[0].hex;

  return (
    <BoardLayout
      options={
        <>
          <div>
            <GroupLabel>{t('colorsLabel')}</GroupLabel>
            <div data-deal="" data-columns="8" className="flex flex-wrap gap-3">
              {HAIR_COLORS.map((hair) => (
                <SwatchButton
                  key={hair.key}
                  color={hair.hex}
                  label={t(`colors.${hair.key}`)}
                  selected={hair.key === color}
                  onSelect={() => setColor(hair.key)}
                />
              ))}
            </div>
          </div>
          <div>
            <GroupLabel>{t('patternsLabel')}</GroupLabel>
            <ChipGroup
              items={HAIR_PATTERNS}
              label={(key) => `categories.hair.patterns.${key}`}
              value={pattern}
              onChange={setPattern}
            />
          </div>
          <div>
            <GroupLabel>{t('stylesLabel')}</GroupLabel>
            <ChipGroup
              items={HAIR_STYLES}
              label={(key) => `categories.hair.styles.${key}`}
              initial="dutchBraid"
            />
          </div>
        </>
      }
      preview={
        <>
          <div
            aria-hidden="true"
            className="rounded-tile aspect-[3/4] w-36 shadow-[0_18px_40px_rgb(5_5_4/0.55)] md:w-44"
            style={{ background: hairBackground(hex, pattern) }}
          />
          <PreviewCaption>
            {t(`colors.${color}`)}, {t(`patterns.${pattern}`)}
          </PreviewCaption>
        </>
      }
    />
  );
}

function WardrobeBoard() {
  const t = useTranslations('Landing.customize.categories.wardrobe');
  const [item, setItem] = useState<(typeof WARDROBE_ITEMS)[number]>('rolledShirt');
  const [fabric, setFabric] = useState(2);

  return (
    <BoardLayout
      options={
        <ChipGroup
          items={WARDROBE_ITEMS}
          label={(key) => `categories.wardrobe.items.${key}`}
          value={item}
          onChange={setItem}
        />
      }
      preview={
        <>
          <p className="font-display text-subhead text-ink text-center">{t(`items.${item}`)}</p>
          <div className="mt-6 flex gap-2.5">
            {FABRIC_COLORS.map((hex, index) => (
              <button
                key={hex}
                type="button"
                aria-pressed={index === fabric}
                aria-label={`${t(`items.${item}`)} ${index + 1}`}
                onClick={() => setFabric(index)}
                className={cn(
                  'ring-offset-backstage-raised size-8 rounded-full ring-offset-2 transition-shadow duration-200',
                  index === fabric ? 'ring-marquee ring-2' : 'ring-hairline ring-1',
                )}
                style={{ background: hex }}
              />
            ))}
          </div>
        </>
      }
    />
  );
}

function JewelryBoard() {
  const t = useTranslations('Landing.customize.categories.jewelry');
  const [item, setItem] = useState<(typeof JEWELRY_ITEMS)[number]>('studs');

  return (
    <BoardLayout
      options={
        <ChipGroup
          items={JEWELRY_ITEMS}
          label={(key) => `categories.jewelry.items.${key}`}
          value={item}
          onChange={setItem}
        />
      }
      preview={
        <>
          {/* A polished bead under the softbox: gold with a hot specular. */}
          <div
            aria-hidden="true"
            className="size-24 rounded-full md:size-28"
            style={{
              background: PREVIEW_LIGHT.gold,
            }}
          />
          <FloorShadow />
          <PreviewCaption>{t(`items.${item}`)}</PreviewCaption>
        </>
      }
    />
  );
}

type CustomizeKey = Parameters<ReturnType<typeof useTranslations<'Landing.customize'>>>[0];

interface ChipGroupProps<Item extends string> {
  items: readonly Item[];
  label: (item: Item) => CustomizeKey;
  /** Uncontrolled starting value. */
  initial?: Item;
  /** Controlled value and change handler. */
  value?: Item;
  onChange?: (item: Item) => void;
}

function ChipGroup<Item extends string>({
  items,
  label,
  initial,
  value,
  onChange,
}: ChipGroupProps<Item>) {
  const t = useTranslations('Landing.customize');
  const [own, setOwn] = useState<Item>(initial ?? items[0]);
  const selected = value ?? own;

  return (
    <div data-deal="" className="flex flex-wrap gap-2.5">
      {items.map((item) => {
        const active = item === selected;
        return (
          <button
            key={item}
            type="button"
            data-option=""
            aria-pressed={active}
            onClick={() => {
              setOwn(item);
              onChange?.(item);
            }}
            className={cn(
              'rounded-tile text-ui h-10 border px-4 transition-colors duration-200',
              active
                ? 'border-marquee bg-backstage-lift text-ink'
                : 'border-hairline bg-backstage-raised text-ink-muted hover:border-ink-faint hover:text-ink',
            )}
          >
            {t(label(item))}
          </button>
        );
      })}
    </div>
  );
}

/*
 * THESIS: A cutting room, not a dashboard. Every exported asset is laid out
 * as a contact sheet; the curator strikes what should not reach the creator.
 * STORY: Pick a category, scan the sheet, select look-alikes in bulk, hide
 * them with one key, check a doubtful one on the stage, save.
 */
'use client';

import {
  ApproximateEqualsIcon,
  ArrowLeftIcon,
  CoatHangerIcon,
  EyeIcon,
  EyeSlashIcon,
  FilmSlateIcon,
} from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'motion/react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { ChipRadio, Segmented } from '@/features/creator/ui/controls';
import { useMhManifest, type ManifestState } from '@/features/creator/useMhManifest';
import { Link } from '@/i18n/navigation';
import { OUTFIT_CATEGORIES, type MhManifest, type OutfitCategory } from '@/lib/assets/manifest';
import { cn } from '@/lib/utils';

import { CurationPreview } from './CurationPreview';
import { CurationTile, useMetaText, type SimilarCaption } from './CurationTile';
import {
  CURATION_TABS,
  groupNearDuplicates,
  itemsFor,
  keptLabel,
  matchesQuery,
  matchesVisibility,
  summarizeAuto,
  type CurationItem,
  type CurationTab,
  type VisibilityFilter,
} from './items';
import { useCuration, type CurationDraft } from './useCuration';

type CategoryFilter = 'all' | OutfitCategory;

const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(8.75rem,1fr))] gap-3';

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export function CurationScreen() {
  const t = useTranslations('Curate');
  const manifestState = useMhManifest({ curated: false });
  const curation = useCuration();

  return (
    <main className="bg-backstage min-h-dvh">
      <div className="mx-auto w-full max-w-[1680px] px-5 pt-8 md:px-10">
        <Link
          href="/"
          className="rounded-tile text-label text-ink-muted hover:text-ink -ml-1 inline-flex items-center gap-1.5 px-1 transition-colors"
        >
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          {t('back')}
        </Link>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-x-10 gap-y-3">
          <div>
            <p className="text-label text-marquee tracking-[0.14em] uppercase">{t('devOnly')}</p>
            <h1 className="font-headline text-headline text-ink mt-2">{t('title')}</h1>
          </div>
          <p className="text-body-sm text-ink-muted max-w-[60ch] pb-1">{t('lede')}</p>
        </div>
      </div>

      {manifestState.status === 'ready' ? (
        <CurationBoard
          manifest={manifestState.manifest}
          fixture={manifestState.fixture}
          curation={curation}
        />
      ) : (
        <ManifestPending state={manifestState} />
      )}
    </main>
  );
}

function ManifestPending({ state }: { state: Exclude<ManifestState, { status: 'ready' }> }) {
  const t = useTranslations('Curate.manifest');
  const tCurate = useTranslations('Curate');
  if (state.status === 'loading') {
    return (
      <div
        role="status"
        aria-label={t('loading')}
        className="mx-auto mt-10 w-full max-w-[1680px] px-5 md:px-10"
      >
        <Skeleton className="h-11 w-[min(100%,52rem)]" />
        <div className={cn(GRID, 'mt-8')}>
          {Array.from({ length: 14 }, (_, index) => (
            <Skeleton key={index} className="aspect-[3/4.4]" />
          ))}
        </div>
      </div>
    );
  }
  const missing = state.status === 'missing';
  return (
    <div className="mx-auto mt-16 w-full max-w-[1680px] px-5 md:px-10">
      <div className="border-hairline rounded-control max-w-[40rem] border p-8">
        <h2 className="text-title text-ink">{missing ? t('missingTitle') : t('errorTitle')}</h2>
        <p className="text-body-sm text-ink-muted mt-2">
          {missing ? t('missingBody') : t('errorBody')}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button type="button" variant="quiet" onClick={state.retry}>
            {tCurate('retry')}
          </Button>
          {missing && state.fixtureAvailable ? (
            <Button asChild variant="ghost">
              <a href="?fixture=1">{t('fixture')}</a>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface BoardProps {
  manifest: MhManifest;
  fixture: boolean;
  curation: CurationDraft;
}

function CurationBoard({ manifest, fixture, curation }: BoardProps) {
  const t = useTranslations('Curate');
  const tItem = useTranslations('Curate.item');
  const format = useFormatter();
  const locale = useLocale();
  const metaText = useMetaText();
  const [tab, setTab] = useState<CurationTab>('faces');
  const [query, setQuery] = useState('');
  // Null until the curator picks one: the default follows the loaded curation.
  const [visibilityChoice, setVisibility] = useState<VisibilityFilter | null>(null);
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [grouped, setGrouped] = useState(false);
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const anchor = useRef<string | null>(null);
  const { hidden, auto, setHidden, toggle } = curation;

  const byTab = useMemo(
    () =>
      Object.fromEntries(
        CURATION_TABS.map((key) => [key, itemsFor(manifest, key, locale)]),
      ) as Record<CurationTab, CurationItem[]>,
    [manifest, locale],
  );

  const autoSummary = useMemo(() => summarizeAuto(byTab, auto, hidden), [byTab, auto, hidden]);
  // With pre-pass picks the sheet starts from what is left after them.
  const visibility = visibilityChoice ?? (autoSummary.total > 0 ? 'visible' : 'all');

  const shown = useMemo(
    () =>
      byTab[tab].filter(
        (item) =>
          (category === 'all' || tab !== 'outfits' || item.category === category) &&
          matchesVisibility(item.id, visibility, hidden, auto) &&
          matchesQuery(item, query),
      ),
    [byTab, tab, category, visibility, hidden, auto, query],
  );

  const groups = useMemo(() => {
    if (!grouped) return null;
    const all = groupNearDuplicates(shown);
    return {
      lookAlikes: all.filter((group) => group.items.length > 1),
      others: all.filter((group) => group.items.length === 1).flatMap((group) => group.items),
    };
  }, [grouped, shown]);

  // On-screen order (look-alike groups first when grouped), for ranges and the preview.
  const ordered = useMemo(
    () =>
      groups ? [...groups.lookAlikes.flatMap((group) => group.items), ...groups.others] : shown,
    [groups, shown],
  );

  const changeTab = (next: CurationTab) => {
    setTab(next);
    setSelection(new Set());
    setCategory('all');
    setQuery('');
    anchor.current = null;
  };

  const select = (id: string, event: MouseEvent<HTMLButtonElement>) => {
    setSelection((current) => {
      const next = new Set(current);
      if (event.shiftKey && anchor.current) {
        const from = ordered.findIndex((item) => item.id === anchor.current);
        const to = ordered.findIndex((item) => item.id === id);
        if (from >= 0 && to >= 0) {
          const [start, end] = from < to ? [from, to] : [to, from];
          for (const item of ordered.slice(start, end + 1)) next.add(item.id);
          return next;
        }
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchor.current = id;
  };

  const viewAuto = () => {
    setVisibility('auto');
    if (autoSummary.perTab[tab] > 0) return;
    const next = CURATION_TABS.find((key) => autoSummary.perTab[key] > 0);
    if (next) changeTab(next);
  };

  const similarOf = (item: CurationItem): SimilarCaption | undefined => {
    const pick = auto[item.id];
    if (!pick) return undefined;
    const value = format.number(pick.distance, { maximumFractionDigits: 2 });
    return {
      label: keptLabel(manifest, pick, locale),
      distance: tItem(pick.unit === 'deg' ? 'distanceDeg' : 'distanceMm', { value }),
    };
  };

  const applyToSelection = (hide: boolean) => {
    setHidden([...selection], hide);
    setSelection(new Set());
  };

  // Bulk shortcuts while the sheet has focus (the preview handles its own keys).
  useEffect(() => {
    if (previewId) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (selection.size === 0) return;
      const key = event.key.toLowerCase();
      if (key === 'h' || key === 'k') {
        event.preventDefault();
        setHidden([...selection], key === 'h');
        setSelection(new Set());
      } else if (key === 'escape') {
        setSelection(new Set());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewId, selection, setHidden]);

  // Unsaved changes survive an accidental reload only with a prompt.
  useEffect(() => {
    if (curation.changes === 0) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [curation.changes]);

  const onSave = async () => {
    const ok = await curation.save();
    if (ok) toast.success(t('saved'));
    else toast.error(t('saveFailed'));
  };

  const canSave = !fixture && curation.load === 'ready' && curation.changes > 0 && !curation.saving;
  const tile = (item: CurationItem) => (
    <CurationTile
      key={item.id}
      item={item}
      meta={metaText(item)}
      hidden={hidden.has(item.id)}
      similar={similarOf(item)}
      selected={selection.has(item.id)}
      onSelect={select}
      onToggle={toggle}
      onPreview={setPreviewId}
    />
  );

  return (
    <>
      <div className="border-hairline bg-backstage sticky top-0 z-(--z-header) mt-8 border-y">
        <div className="mx-auto flex w-full max-w-[1680px] flex-wrap items-center justify-between gap-x-6 px-5 md:px-10">
          <div
            role="tablist"
            aria-label={t('tabsLabel')}
            className="-mb-px flex min-w-0 gap-1 overflow-x-auto"
            onKeyDown={(event) => {
              const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
              if (!delta) return;
              event.preventDefault();
              const index = CURATION_TABS.indexOf(tab);
              const next =
                CURATION_TABS[(index + delta + CURATION_TABS.length) % CURATION_TABS.length];
              changeTab(next);
              event.currentTarget.querySelector<HTMLButtonElement>(`#curate-tab-${next}`)?.focus();
            }}
          >
            {CURATION_TABS.map((key) => {
              const total = byTab[key].length;
              const visible = byTab[key].filter((item) => !hidden.has(item.id)).length;
              const active = key === tab;
              return (
                <button
                  key={key}
                  id={`curate-tab-${key}`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls="curate-panel"
                  tabIndex={active ? 0 : -1}
                  onClick={() => changeTab(key)}
                  className={cn(
                    'text-ui relative flex h-12 shrink-0 items-center gap-2 px-3 transition-colors duration-200',
                    active ? 'text-ink' : 'text-ink-muted hover:text-ink',
                  )}
                >
                  {t(`tabs.${key}`)}
                  <span aria-hidden="true" className="text-label text-ink-faint tabular-nums">
                    {visible}/{total}
                  </span>
                  <span className="sr-only">{t('tabCount', { visible, total })}</span>
                  {active ? (
                    <motion.span
                      layoutId="curate-tab-rule"
                      className="bg-marquee absolute inset-x-3 bottom-0 h-0.5"
                      transition={{ type: 'spring', stiffness: 520, damping: 42 }}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3 py-2">
            <p role="status" className="text-label text-ink-muted whitespace-nowrap">
              {fixture
                ? t('status.fixture')
                : curation.changes > 0
                  ? t('status.unsaved', { count: curation.changes })
                  : t('status.clean')}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={curation.changes === 0 || curation.saving}
              onClick={curation.discard}
            >
              {t('discard')}
            </Button>
            <Button type="button" variant="primary" size="sm" disabled={!canSave} onClick={onSave}>
              {curation.saving ? t('saving') : t('save')}
            </Button>
          </div>
        </div>
      </div>

      <div
        id="curate-panel"
        role="tabpanel"
        aria-labelledby={`curate-tab-${tab}`}
        className="mx-auto w-full max-w-[1680px] px-5 pt-6 pb-32 md:px-10"
      >
        {curation.load === 'error' ? (
          <div
            role="alert"
            className="border-hairline rounded-control text-body-sm text-ink-muted mb-6 flex flex-wrap items-center justify-between gap-3 border px-4 py-3"
          >
            {t('loadFailed')}
            <Button type="button" variant="quiet" size="sm" onClick={curation.retry}>
              {t('retry')}
            </Button>
          </div>
        ) : null}

        <div
          className={cn(
            'flex flex-wrap items-center gap-x-6 gap-y-3',
            byTab[tab].length === 0 && 'hidden',
          )}
        >
          <label className="flex items-center gap-3">
            <span className="sr-only">{t('searchLabel')}</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('searchPlaceholder')}
              className="rounded-control border-hairline bg-backstage-raised text-ui text-ink placeholder:text-ink-faint focus-visible:border-marquee h-10 w-64 border px-3 outline-none"
            />
          </label>
          <Segmented
            label={t('filter.label')}
            value={visibility}
            onChange={setVisibility}
            options={[
              { value: 'all', label: t('filter.all') },
              { value: 'visible', label: t('filter.visible') },
              { value: 'hidden', label: t('filter.hidden') },
              ...(autoSummary.total > 0
                ? [{ value: 'auto' as const, label: t('filter.auto') }]
                : []),
            ]}
            // The longer pre-pass label sizes its own segment instead of truncating.
            className={autoSummary.total > 0 ? '[&>[role=radio]]:flex-auto' : 'w-64'}
          />
          {/* Look-alike grouping: the switch is labelled by its visible text. */}
          <label className="text-ui text-ink-muted flex cursor-pointer items-center gap-2.5">
            <Switch checked={grouped} onCheckedChange={setGrouped} />
            {t('group')}
          </label>
          {shown.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => setSelection(new Set(ordered.map((item) => item.id)))}
            >
              {t('selection.selectAll')}
            </Button>
          ) : null}
        </div>

        {tab === 'outfits' && byTab.outfits.length > 0 ? (
          <div className="mt-4">
            <ChipRadio
              label={t('outfitCategory.label')}
              value={category}
              onChange={(value) => {
                setCategory(value);
                setSelection(new Set());
              }}
              options={[
                { value: 'all' as const, label: t('outfitCategory.all') },
                ...OUTFIT_CATEGORIES.map((value) => ({
                  value,
                  label: t(`outfitCategory.${value}`),
                })),
              ]}
            />
          </div>
        ) : null}

        {autoSummary.total > 0 && byTab[tab].length > 0 ? (
          <AutoNotice
            total={autoSummary.total}
            restored={autoSummary.total - autoSummary.hidden}
            viewing={visibility === 'auto'}
            onView={viewAuto}
            onLeave={() => setVisibility('visible')}
          />
        ) : null}

        <div className="mt-6">
          {byTab[tab].length === 0 ? (
            <EmptyTab tab={tab} />
          ) : shown.length === 0 ? (
            <p className="text-body-sm text-ink-muted py-16 text-center">
              {query.trim() ? t('noResults', { query: query.trim() }) : t('noFilterResults')}
            </p>
          ) : groups ? (
            <div className="flex flex-col gap-10">
              {groups.lookAlikes.map((group) => {
                const ids = group.items.map((item) => item.id);
                const allHidden = ids.every((id) => hidden.has(id));
                return (
                  <section key={group.stem} aria-label={group.stem}>
                    <header className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <h2 className="text-ui text-ink capitalize">{group.stem}</h2>
                      <span className="text-label text-ink-faint">
                        {t('groups.count', { count: group.items.length })}
                      </span>
                      <span aria-hidden="true" className="bg-hairline h-px min-w-8 flex-1" />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelection((current) => new Set([...current, ...ids]))}
                      >
                        {t('groups.select')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setHidden(ids, !allHidden)}
                      >
                        {allHidden ? t('groups.show') : t('groups.hide')}
                      </Button>
                    </header>
                    <ul className={GRID}>{group.items.map(tile)}</ul>
                  </section>
                );
              })}
              {groups.others.length > 0 ? (
                <section aria-label={t('groups.others')}>
                  <header className="mb-3 flex items-center gap-3">
                    <h2 className="text-ui text-ink">{t('groups.others')}</h2>
                    <span className="text-label text-ink-faint">
                      {t('groups.count', { count: groups.others.length })}
                    </span>
                    <span aria-hidden="true" className="bg-hairline h-px flex-1" />
                  </header>
                  <ul className={GRID}>{groups.others.map(tile)}</ul>
                </section>
              ) : null}
            </div>
          ) : (
            <ul className={GRID}>{shown.map(tile)}</ul>
          )}
        </div>
      </div>

      <SelectionBar
        count={selection.size}
        onHide={() => applyToSelection(true)}
        onShow={() => applyToSelection(false)}
        onClear={() => setSelection(new Set())}
      />

      <CurationPreview
        manifest={manifest}
        fixture={fixture}
        tab={tab}
        items={ordered}
        id={previewId}
        isHidden={(id) => hidden.has(id)}
        onToggle={toggle}
        onNavigate={setPreviewId}
        onClose={() => setPreviewId(null)}
      />
    </>
  );
}

/**
 * One quiet line above the sheet: how many items the similarity pre-pass
 * picked, and how many of those the curator has kept again.
 */
function AutoNotice({
  total,
  restored,
  viewing,
  onView,
  onLeave,
}: {
  total: number;
  restored: number;
  viewing: boolean;
  onView: () => void;
  onLeave: () => void;
}) {
  const t = useTranslations('Curate.auto');
  return (
    <div className="border-hairline mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 border-l-2 py-1 pl-3">
      <ApproximateEqualsIcon className="text-ink-faint size-4 shrink-0" aria-hidden="true" />
      <p className="text-body-sm text-ink-muted">
        {t('notice', { count: total })}
        {restored > 0 ? (
          <span className="text-ink-faint"> {t('restored', { count: restored })}</span>
        ) : null}
      </p>
      <Button type="button" variant="ghost" size="sm" onClick={viewing ? onLeave : onView}>
        {viewing ? t('leave') : t('view')}
      </Button>
    </div>
  );
}

function EmptyTab({ tab }: { tab: CurationTab }) {
  const t = useTranslations('Curate.empty');
  const outfits = tab === 'outfits';
  const Icon = outfits ? CoatHangerIcon : FilmSlateIcon;
  return (
    <div className="flex flex-col items-center py-20 text-center">
      <Icon className="text-ink-faint size-12" weight="thin" aria-hidden="true" />
      <h2 className="text-title text-ink mt-5">{outfits ? t('outfitsTitle') : t('title')}</h2>
      <p className="text-body-sm text-ink-muted mt-2 max-w-[44ch]">
        {outfits ? t('outfitsBody') : t('body')}
      </p>
    </div>
  );
}

function SelectionBar({
  count,
  onHide,
  onShow,
  onClear,
}: {
  count: number;
  onHide: () => void;
  onShow: () => void;
  onClear: () => void;
}) {
  const t = useTranslations('Curate.selection');
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-(--z-header) flex justify-center px-4">
      <AnimatePresence>
        {count > 0 ? (
          <motion.div
            role="region"
            aria-label={t('label')}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="rounded-control border-hairline bg-backstage-raised pointer-events-auto flex flex-wrap items-center gap-2 border py-2 pr-2 pl-4 shadow-[0_18px_40px_rgb(5_5_4/0.55)]"
          >
            <p className="text-ui text-ink tabular-nums" aria-live="polite">
              {t('count', { count })}
            </p>
            <p className="text-label text-ink-faint mr-2 hidden md:block">{t('shortcuts')}</p>
            <Button type="button" variant="quiet" size="sm" onClick={onHide}>
              <EyeSlashIcon aria-hidden="true" />
              {t('hide')}
            </Button>
            <Button type="button" variant="quiet" size="sm" onClick={onShow}>
              <EyeIcon aria-hidden="true" />
              {t('show')}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onClear}>
              {t('clear')}
            </Button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

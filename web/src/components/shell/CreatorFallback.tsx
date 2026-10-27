import { useTranslations } from 'next-intl';

import { StagePoster } from '@/components/stage/StagePoster';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Static stand-in for the creator while the saved character streams in: the
 * panel's header, rail, option list and action row as quiet shapes.
 */
export function CreatorFallback() {
  const t = useTranslations('Creator');

  return (
    <div
      className="bg-paper relative h-dvh w-full overflow-hidden"
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">{t('loadingStage')}</span>
      <div className="absolute inset-0 [--stage-floor:82%] [--stage-x:50%] lg:[--stage-x:calc(50%+clamp(440px,32vw,500px)/2)]">
        <StagePoster />
      </div>
      <div className="border-hairline bg-paper-raised absolute inset-y-0 left-0 hidden w-[clamp(440px,32vw,500px)] flex-col border-r lg:flex">
        <div className="border-hairline flex items-center gap-3 border-b px-[18px] py-3.5">
          <Skeleton className="size-9 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-2.5 w-24 rounded-full" />
            <Skeleton className="h-5 w-40 rounded-full" />
          </div>
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="border-hairline flex w-[72px] shrink-0 flex-col items-center gap-7 border-r pt-5">
            {Array.from({ length: 10 }, (_, index) => (
              <Skeleton key={index} className="size-5 rounded-full" />
            ))}
          </div>
          <div className="flex flex-1 flex-col gap-3 px-[18px] pt-5">
            <Skeleton className="h-2.5 w-20 rounded-full" />
            <div className="grid grid-cols-2 gap-2.5">
              {Array.from({ length: 2 }, (_, index) => (
                <Skeleton key={index} className="aspect-[3/4] w-full" />
              ))}
            </div>
          </div>
        </div>
        <div className="border-hairline flex items-center gap-2 border-t px-3.5 py-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-9 w-16 rounded-full" />
          ))}
          <Skeleton className="ml-auto h-11 w-28 rounded-full" />
        </div>
      </div>
    </div>
  );
}

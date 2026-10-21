import { useTranslations } from 'next-intl';

import { StagePoster } from '@/components/stage/StagePoster';
import { Skeleton } from '@/components/ui/skeleton';

/** Static stand-in for the creator while the saved character streams in. */
export function CreatorFallback() {
  const t = useTranslations('Creator');

  return (
    <div
      className="bg-backstage relative h-dvh w-full overflow-hidden"
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">{t('loadingStage')}</span>
      <div className="absolute inset-0 [--stage-floor:82%] [--stage-x:66%]">
        <StagePoster />
      </div>
      <div className="border-hairline bg-backstage absolute inset-y-0 left-0 hidden w-[clamp(420px,34vw,560px)] flex-col gap-4 border-r p-6 lg:flex">
        <Skeleton className="h-4 w-28 rounded-full" />
        <Skeleton className="h-12 w-3/4" />
        <div className="mt-6 grid grid-cols-3 gap-2.5">
          {Array.from({ length: 9 }, (_, index) => (
            <Skeleton key={index} className="aspect-[3/4] w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

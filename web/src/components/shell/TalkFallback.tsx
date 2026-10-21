import { useTranslations } from 'next-intl';

import { StagePoster } from '@/components/stage/StagePoster';
import { Skeleton } from '@/components/ui/skeleton';

/** Static stand-in for the talk screen while the character streams in. */
export function TalkFallback() {
  const t = useTranslations('Creator');

  return (
    <div
      className="bg-backstage relative h-dvh w-full overflow-hidden"
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">{t('loadingStage')}</span>
      <div className="absolute inset-0 [--stage-floor:84%] [--stage-x:35%]">
        <StagePoster />
      </div>
      <div className="border-hairline bg-backstage absolute inset-y-0 right-0 hidden w-[clamp(360px,30vw,480px)] flex-col gap-4 border-l p-5 lg:flex">
        <Skeleton className="h-5 w-24 rounded-full" />
        <Skeleton className="h-3 w-40 rounded-full" />
        <div className="mt-auto flex flex-col gap-3">
          <Skeleton className="h-16 w-3/4" />
          <Skeleton className="ml-auto h-10 w-1/2" />
          <Skeleton className="h-14 w-full" />
        </div>
      </div>
    </div>
  );
}

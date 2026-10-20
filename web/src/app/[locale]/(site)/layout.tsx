import { SiteFooter } from '@/components/shell/SiteFooter';
import { SiteHeader } from '@/components/shell/SiteHeader';
import { SkipLink } from '@/components/shell/SkipLink';

/** Public pages (landing, characters): header, main landmark, footer. */
export default function SiteLayout({ children }: LayoutProps<'/[locale]'>) {
  return (
    <>
      <SkipLink target="main" />
      <SiteHeader />
      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}

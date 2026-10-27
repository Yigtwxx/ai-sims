'use client';

import { ListIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import { Suspense, useState } from 'react';

import { EnterForm } from '@/components/EnterForm';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { SignOutForm } from '@/components/SignOutForm';
import type { EnterDestination } from '@/components/session/enterAction';
import type { Viewer } from '@/components/session/viewer';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/characters', key: 'characters' },
  { href: '/create', key: 'create' },
] as const satisfies readonly { href: EnterDestination; key: string }[];

interface HeaderNavProps {
  /** `null` while the session is still streaming in. */
  viewer: Viewer | null;
}

/**
 * Navigation, locale switch and session action. Signed-out visitors get the
 * same links as one-click "enter" forms, so a protected link never bounces.
 */
export function HeaderNav({ viewer }: HeaderNavProps) {
  const t = useTranslations('Nav');
  const [menuOpen, setMenuOpen] = useState(false);
  const signedOut = viewer?.signedIn === false;

  const renderItem = (item: (typeof NAV_ITEMS)[number], large = false) => {
    if (signedOut) {
      return (
        <EnterForm
          next={item.href}
          variant="ghost"
          className={cn(
            linkClass(false, large),
            'rounded-none bg-transparent font-medium hover:bg-transparent',
          )}
        >
          {t(item.key)}
        </EnterForm>
      );
    }
    const link: NavLinkProps = {
      href: item.href,
      label: t(item.key),
      large,
      onNavigate: () => setMenuOpen(false),
    };
    // The active state reads the pathname, which is request data on dynamic
    // routes (Cache Components), so it sits behind its own boundary.
    return (
      <Suspense fallback={<NavLinkView {...link} active={false} />}>
        <ActiveNavLink {...link} />
      </Suspense>
    );
  };

  const sessionAction =
    viewer === null ? (
      <Skeleton className="h-9 w-[72px] rounded-full" />
    ) : viewer.signedIn ? (
      <SignOutForm />
    ) : (
      <EnterForm next="/characters" variant="primary" size="sm" className="px-4" />
    );

  return (
    <>
      <nav aria-label={t('label')} className="ml-6 hidden md:block lg:ml-10">
        <ul className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => (
            <li key={item.href}>{renderItem(item)}</li>
          ))}
        </ul>
      </nav>

      <div className="ml-auto flex items-center gap-2 md:gap-3">
        <LocaleSwitcher className="hidden md:block" />
        <div className="hidden md:block">{sessionAction}</div>

        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger
            className="rounded-control text-ink hover:bg-paper-raised inline-flex size-10 items-center justify-center transition-colors duration-200 md:hidden"
            aria-label={t('menu')}
          >
            <ListIcon className="size-6" aria-hidden="true" />
          </SheetTrigger>
          <SheetContent side="right" closeLabel={t('closeMenu')} aria-describedby={undefined}>
            <SheetHeader className="pt-6">
              <SheetTitle className="text-ink-muted">{t('menu')}</SheetTitle>
            </SheetHeader>
            <nav aria-label={t('label')} className="px-5">
              <ul className="flex flex-col gap-2">
                {NAV_ITEMS.map((item) => (
                  <li key={item.href}>{renderItem(item, true)}</li>
                ))}
              </ul>
            </nav>
            <SheetFooter className="border-hairline flex-row items-center justify-between border-t">
              <LocaleSwitcher />
              {sessionAction}
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}

interface NavLinkProps {
  href: EnterDestination;
  label: string;
  large: boolean;
  onNavigate: () => void;
}

function linkClass(active: boolean, large: boolean) {
  return cn(
    'group relative inline-flex items-center transition-colors duration-200',
    large ? 'h-12 px-0 font-headline text-subhead' : 'h-9 px-3 text-ui font-medium',
    active ? 'text-ink' : 'text-ink-muted hover:text-ink',
  );
}

function NavLinkView({
  href,
  label,
  large,
  onNavigate,
  active,
}: NavLinkProps & { active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={linkClass(active, large)}
      onClick={onNavigate}
    >
      {label}
      {large ? null : (
        <span
          aria-hidden="true"
          className={cn(
            'bg-cobalt ease-out-expo absolute inset-x-3 bottom-1 h-px origin-left transition-transform duration-300',
            active ? 'scale-x-100' : 'group-hover:bg-hairline scale-x-0 group-hover:scale-x-100',
          )}
        />
      )}
    </Link>
  );
}

function ActiveNavLink(props: NavLinkProps) {
  const pathname = usePathname();
  const active = pathname === props.href || pathname.startsWith(`${props.href}/`);
  return <NavLinkView {...props} active={active} />;
}

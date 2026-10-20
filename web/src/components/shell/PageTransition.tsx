import { ViewTransition, type ReactNode } from 'react';

/**
 * Wraps a page's content so route navigations play the page enter/exit
 * view transition (see `.page-enter` / `.page-exit` in globals.css). Put it in
 * each page, not a layout: layouts persist, so enter/exit never fire there.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition enter="page-enter" exit="page-exit" default="none">
      {children}
    </ViewTransition>
  );
}

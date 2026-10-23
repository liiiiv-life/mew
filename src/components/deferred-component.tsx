import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { PanelLoading } from './startup-screen'

/** Keep a tool's download inside its own boundary so the workspace stays usable. */
export function deferredComponent<Props extends object>(load: () => Promise<{ default: ComponentType<Props> }>, fallback: ReactNode = <PanelLoading />) {
  const Component = lazy(load)
  return function DeferredComponent(props: Props) {
    return <Suspense fallback={fallback}><Component {...props} /></Suspense>
  }
}

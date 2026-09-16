import { useCallback, useEffect, useRef, useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog'
import { PromptDialog } from './prompt-dialog'

type Options = { message: string; detail?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean }
export type PromptOptions = Options & { defaultValue?: string; label?: string }
type Request = { options: PromptOptions; kind: 'confirm' | 'prompt'; resolve: (value: string | boolean | null) => void }

/** Resolve on cancel/unmount too, so an abandoned dialog never leaves a pending caller. */
export function useDialog() {
  const [request, setRequest] = useState<Request | null>(null)
  const pending = useRef<Request | null>(null)
  const finish = useCallback((value: string | boolean | null) => {
    pending.current?.resolve(value)
    pending.current = null
    setRequest(null)
  }, [])
  useEffect(() => () => { pending.current?.resolve(null); pending.current = null }, [])
  const ask = useCallback((kind: Request['kind'], options: PromptOptions) => new Promise<string | boolean | null>((resolve) => {
    pending.current?.resolve(null)
    const next = { kind, options, resolve }
    pending.current = next
    setRequest(next)
  }), [])
  return {
    confirm: useCallback(async (options: Options) => (await ask('confirm', options)) === true, [ask]),
    prompt: useCallback(async (options: PromptOptions) => {
      const result = await ask('prompt', options)
      return typeof result === 'string' ? result : null
    }, [ask]),
    dialog: request?.kind === 'prompt'
      ? <PromptDialog key={request.options.message} options={request.options} onDone={finish} />
      : request ? <ConfirmDialog {...request.options} onConfirm={() => finish(true)} onCancel={() => finish(false)} /> : null,
  }
}

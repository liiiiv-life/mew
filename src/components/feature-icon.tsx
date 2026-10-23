import type { SVGProps } from 'react'

export function FeatureIcon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}><circle cx="5" cy="5" r="2" /><path d="M10 5h11M5 9v10h3M12 13h9M12 19h9" /><circle cx="10" cy="13" r="1" /><circle cx="10" cy="19" r="1" /></svg>
}

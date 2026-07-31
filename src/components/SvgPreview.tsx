import { useEffect, useState } from 'react'

// <img>로 렌더링하면 SVG 안에 내장된 스크립트가 실행되지 않는다 (iframe·dangerouslySetInnerHTML과 달리 안전)
export function SvgPreview({ content }: { content: string }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    const blob = new Blob([content], { type: 'image/svg+xml' })
    const objectUrl = URL.createObjectURL(blob)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [content])

  return (
    <div className="flex h-full w-full items-center justify-center overflow-auto bg-surface p-6">
      {url && <img src={url} alt="SVG preview" className="max-h-full max-w-full object-contain" />}
    </div>
  )
}

export function clipboardImages(data: DataTransfer | null): File[] {
  if (!data) return []
  const files = Array.from(data.files).filter(file => file.type.startsWith('image/'))
  return files.length ? files : Array.from(data.items)
    .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
    .map(item => item.getAsFile()).filter((file): file is File => file !== null)
}


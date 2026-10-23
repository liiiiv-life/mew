export type DatabaseIcon = 'table' | 'cards' | 'board' | 'calendar' | 'gantt' | 'search' | 'close' | 'left' | 'right' | 'plus' | 'minus' | 'page' | 'trash' | 'fields'
const paths: Record<DatabaseIcon, string> = {
  table: 'M4 4h16v16H4zM4 9h16M9 4v16M4 14h16',
  cards: 'M4 4h6v7H4zM14 4h6v7h-6zM4 15h6v5H4zM14 15h6v5h-6z',
  board: 'M4 4h4v16H4zM10 4h4v11h-4zM16 4h4v14h-4z',
  calendar: 'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM3 10h18M8 3v4M16 3v4M7 14h2M13 14h2M7 17h2',
  gantt: 'M4 5h7v3H4zM9 11h10v3H9zM6 17h9v3H6z',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  close: 'm6 6 12 12M6 18 18 6', left: 'm15 5-7 7 7 7', right: 'm9 5 7 7-7 7',
  minus: 'M5 12h14',
  plus: 'M12 5v14M5 12h14', page: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6ZM14 3v6h6M8 13h8M8 17h5',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  fields: 'M4 6h16M4 12h16M4 18h16M8 4v4M16 10v4M10 16v4',
}
export function DatabaseLayoutIcon({ kind, size = 16 }: { kind: DatabaseIcon; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0"><path d={paths[kind]} /></svg>
}

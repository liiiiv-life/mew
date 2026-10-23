import { createContext } from 'react'

export const ImageSourceContext = createContext<(src: string) => string>(src => src)

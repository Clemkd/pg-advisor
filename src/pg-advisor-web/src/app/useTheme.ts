import { useContext } from 'react'
import { ThemeContext, type ThemeState } from './ThemeContext'

export function useTheme(): ThemeState {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme doit être utilisé dans un ThemeProvider.')
  }
  return context
}

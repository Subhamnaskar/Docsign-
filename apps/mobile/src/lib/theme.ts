import { useColorScheme } from 'react-native';

/** NuronixAI gold, matching the website (apps/web globals.css). */
export const gold = {
  50: '#fdf8ec',
  100: '#f9ecc9',
  300: '#e4bd6a',
  400: '#d4a24e',
  500: '#b8860b',
  600: '#9a6f08',
  700: '#7a5806',
} as const;

export interface Theme {
  background: string;
  card: string;
  border: string;
  text: string;
  textMuted: string;
  primary: string;
  primaryText: string;
  danger: string;
  success: string;
  warning: string;
  info: string;
}

const light: Theme = {
  background: '#faf8f3',
  card: '#ffffff',
  border: '#ece6d8',
  text: '#14110b',
  textMuted: '#6b6457',
  primary: gold[500],
  primaryText: '#14110b',
  danger: '#b42318',
  success: '#127a3c',
  warning: '#9a6f08',
  info: '#2f5fb3',
};

const dark: Theme = {
  background: '#0a0a12',
  card: '#15141c',
  border: '#2a2833',
  text: '#f4f1ea',
  textMuted: '#a39e92',
  primary: gold[400],
  primaryText: '#14110b',
  danger: '#f97066',
  success: '#47cd89',
  warning: gold[300],
  info: '#84adff',
};

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

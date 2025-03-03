import { ViewSettings } from '@/types/book';

export const getMaxInlineSize = (viewSettings: ViewSettings) => {
  const isScrolled = viewSettings.scrolled!;
  const maxColumnCount = viewSettings.maxColumnCount!;
  const screenWidth = window.innerWidth;

  return maxColumnCount === 1 || isScrolled ? screenWidth : viewSettings.maxInlineSize!;
};

export const getDefaultMaxInlineSize = () => {
  if (typeof window === 'undefined') return 720;

  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  return screenWidth < screenHeight ? screenWidth : 720;
};

export const getDefaultMaxBlockSize = () => {
  if (typeof window === 'undefined') return 1440;

  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  return Math.max(screenWidth, screenHeight);
};

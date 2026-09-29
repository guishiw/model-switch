import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export const cn = (...i: ClassValue[]) => twMerge(clsx(i));
export const fmt = (n: number | bigint) => new Intl.NumberFormat('en-US').format(Number(n));
export const fmtSeconds = (milliseconds: number) => `${(milliseconds / 1000).toFixed(3)} s`;

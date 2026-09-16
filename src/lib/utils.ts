import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export const cn = (...i: ClassValue[]) => twMerge(clsx(i));
export const fmt = (n: number | bigint) => new Intl.NumberFormat('en-US').format(Number(n));

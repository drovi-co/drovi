import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Get the web app URL for navigation links
 * In development, this points to localhost:5173
 * In production, this should point to app.drovi.io or similar
 */
export function getAppUrl(path = "") {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001";
  return `${baseUrl}${path}`;
}

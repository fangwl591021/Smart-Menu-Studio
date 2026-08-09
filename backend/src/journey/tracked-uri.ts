import { timingSafeEqual } from 'node:crypto';

export const TRACKED_URI_TTL_MS = 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
export function createAttributionToken() { const bytes = new Uint8Array(32); crypto.getRandomValues(bytes); return `smat_${base64url(bytes)}`; }
export async function trackedTokenHash(token: string) { const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token)); return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
export async function destinationFingerprint(destination: string) { const url = safeDestination(destination); if (!url) return ''; return trackedTokenHash(url.toString()); }
export function safeDestination(value: string) { try { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password || url.port) return null; return url; } catch { return null; } }
export function appendAttributionToken(destination: string, token: string) { const url = safeDestination(destination); if (!url || url.searchParams.has('sm_at')) return null; url.searchParams.set('sm_at', token); return url.toString(); }
export function tokenEqual(left: string, right: string) { const a=encoder.encode(left),b=encoder.encode(right); return a.length===b.length && timingSafeEqual(a,b); }

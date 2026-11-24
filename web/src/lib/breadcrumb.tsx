'use client';
import { createContext, useContext, useState, type ReactNode } from 'react';

export interface BreadcrumbEntry { label: string; href?: string }

interface BreadcrumbCtx {
  crumbs: BreadcrumbEntry[];
  setCrumbs: (crumbs: BreadcrumbEntry[]) => void;
}

const Ctx = createContext<BreadcrumbCtx>({ crumbs: [], setCrumbs: () => {} });

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [crumbs, setCrumbs] = useState<BreadcrumbEntry[]>([]);
  return <Ctx.Provider value={{ crumbs, setCrumbs }}>{children}</Ctx.Provider>;
}

export function useBreadcrumb() { return useContext(Ctx); }

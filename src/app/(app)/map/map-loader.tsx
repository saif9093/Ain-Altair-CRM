"use client";
import dynamic from "next/dynamic";
export const MapLoader = dynamic(() => import("./lead-map").then((m) => m.LeadMap), { ssr: false, loading: () => <div className="h-[70vh] animate-pulse rounded-2xl bg-ink-4" /> });

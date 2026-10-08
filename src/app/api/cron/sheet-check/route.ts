import { NextResponse } from "next/server";
import { readPublicSheet } from "@/lib/imports/public-sheet";

/** Ops diagnostic: can the server read a public Google Sheet? Protected by CRON_SECRET; returns counts only. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const url = new URL(req.url).searchParams.get("url") ?? "";
  try {
    const r = await readPublicSheet(url);
    return NextResponse.json({ ok: true, title: r.title, columns: r.headers.length, rows: r.rows.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message });
  }
}

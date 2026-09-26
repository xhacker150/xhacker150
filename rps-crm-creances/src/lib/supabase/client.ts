"use client";
import { createBrowserClient } from "@supabase/ssr";
import { clePubliable, urlSupabase } from "./cles";

/** Client Supabase côté navigateur (composants clients). */
export function createClient() {
  return createBrowserClient(
    urlSupabase(),
    clePubliable()
  );
}

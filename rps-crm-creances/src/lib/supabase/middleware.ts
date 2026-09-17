import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const ROUTES_PUBLIQUES = ["/login", "/api/cron", "/api/pont", "/manifest.webmanifest", "/sw.js", "/hors-ligne"];

/** Rafraîchit la session Supabase et protège les pages ; les routes publiques ne déclenchent aucun appel Auth. */
export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (ROUTES_PUBLIQUES.some((r) => pathname.startsWith(r)) && pathname !== "/login") {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && pathname !== "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("suivant", pathname);
    return NextResponse.redirect(url);
  }
  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return supabaseResponse;
}

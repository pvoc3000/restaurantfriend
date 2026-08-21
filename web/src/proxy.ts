import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabaseEnv } from "@/lib/supabase/env";

// Next 16's replacement for middleware.ts (same thing, new file convention).
// Runs on every request: refreshes the Supabase auth token (writing the updated
// cookies onto the response) and bounces signed-out users to /login.
export default async function proxy(request: NextRequest) {
  const { url, anonKey } = supabaseEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Do not run code between createServerClient and getUser() — see Supabase docs.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isLoginPage = request.nextUrl.pathname.startsWith("/login");
  // An invited person arrives at /welcome with NO session — the one-time token
  // in the URL isn't spent until they submit the form. Without this exemption
  // they'd be bounced to /login, which is a password page for an account whose
  // password doesn't exist yet: the invite link would simply never work.
  const isWelcomePage = request.nextUrl.pathname.startsWith("/welcome");
  // Decision 17: the quote-approval page is PUBLIC on purpose. A customer
  // holding the link has no account and never will — bouncing them to /login
  // would make the approval flow impossible rather than merely awkward.
  //
  // What makes a public route in an auth-gated app safe is not this line, it is
  // what the page can REACH: two definer RPCs (migration 052) that read one
  // token row and write one approval, and nothing else in the schema. See that
  // migration's header for the full argument.
  const isQuotePage = request.nextUrl.pathname.startsWith("/q/");
  // Decision 18: the inquiry form is the front door, so it is public by
  // definition — a customer filling it in has never heard of this app. Note NO
  // trailing slash, unlike `/q/`, so the bare `/inquiry` matches.
  //
  // Same argument as above about what makes this sound: the page reaches two
  // definer RPCs from migration 057 (list the shops, create a lead) and nothing
  // else. Every table policy still names supervisor+.
  const isInquiryPage = request.nextUrl.pathname.startsWith("/inquiry");

  if (!user && !isLoginPage && !isWelcomePage && !isQuotePage && !isInquiryPage) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  if (user && isLoginPage) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // everything except static assets
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

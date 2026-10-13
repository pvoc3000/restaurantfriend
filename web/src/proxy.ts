import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabaseEnv } from "@/lib/supabase/env";
import {
  DEADLINE_COOKIE,
  DEVICE_COOKIE,
  PIN_SESSION_COOKIE,
  serverLocked,
} from "@/lib/sharedDevice";
import { clearSessionCookies } from "@/lib/sessionCookies";

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
  // The pay link (migration 119) — the approval page's twin, for an invoice.
  // Same argument: it reaches three definer RPCs that read one token and claim
  // it, and the charge itself happens in `square-pay`, gated on the same token.
  const isPayPage = request.nextUrl.pathname.startsWith("/pay/");
  // Decision 18: the inquiry form is the front door, so it is public by
  // definition — a customer filling it in has never heard of this app. Note NO
  // trailing slash, unlike `/q/`, so the bare `/inquiry` matches.
  //
  // Same argument as above about what makes this sound: the page reaches two
  // definer RPCs from migration 057 (list the shops, create a lead) and nothing
  // else. Every table policy still names supervisor+.
  const isInquiryPage = request.nextUrl.pathname.startsWith("/inquiry");
  // The two documents Intuit requires at a public https URL before it will
  // issue production keys, and the reviewers who fetch them have no account.
  //
  // Of the five exemptions here this is the one that needs the least argument:
  // the others reach definer RPCs, and these pages reach NOTHING. They are
  // static text with no query, no form and no parameter.
  const isLegalPage = request.nextUrl.pathname.startsWith("/legal");
  // The shared iPad's picker (migration 097). Reached SIGNED OUT by design:
  // after an idle lock there is no session, and the page's own data comes
  // through a server action carrying the device cookie, never a user.
  const isLockPage = request.nextUrl.pathname.startsWith("/lock");
  // Staff how-to guides: static text, readable before you have a login — the
  // first one explains how to get one. `/legal`'s reasoning.
  const isGuidePage = request.nextUrl.pathname.startsWith("/guides");
  // The published calendar feed (migration 185): a calendar app fetches it
  // signed out, holding a token. `/q/`'s argument — it reaches one definer
  // function that reads one link row. Trailing slash, so `/calendar` itself
  // stays behind the login.
  const isCalendarFeed = request.nextUrl.pathname.startsWith("/calendar-feed/");
  const isRegisteredDevice = request.cookies.has(DEVICE_COOKIE);

  const isPublicPage =
    isLoginPage ||
    isWelcomePage ||
    isQuotePage ||
    isPayPage ||
    isInquiryPage ||
    isLegalPage ||
    isLockPage ||
    isGuidePage ||
    isCalendarFeed;

  if (!user && !isPublicPage) {
    const redirectUrl = request.nextUrl.clone();
    // A registered iPad wakes up on its picker, not the password screen —
    // /login stays reachable from the picker as the escape hatch.
    redirectUrl.pathname = isRegisteredDevice ? "/lock" : "/login";
    redirectUrl.search = "";
    const redirect = NextResponse.redirect(redirectUrl);
    // Nobody is signed in, so the last session's lock time means nothing —
    // and left behind it would lock the same person's next password sign-in.
    redirect.cookies.delete(DEADLINE_COOKIE);
    return redirect;
  }

  // THE SHARED iPAD'S IDLE LOCK, SERVER SIDE (2026-10-13). `IdleLock` locks
  // from the page, which needs a page that is alive; this refuses the request
  // itself once the device's lock time has passed. See `serverLocked` in
  // `lib/sharedDevice` for the rule and `/device-touch` for what moves it.
  if (
    user &&
    isRegisteredDevice &&
    !isPublicPage &&
    serverLocked(
      request.cookies.get(DEADLINE_COOKIE)?.value,
      user.id,
      request.cookies.get(PIN_SESSION_COOKIE)?.value === "1",
      Date.now()
    )
  ) {
    // `local`, as everywhere: locking the iPad must not sign anybody out of
    // their own phone. The sign-out writes its cleared cookies onto `response`.
    await supabase.auth.signOut({ scope: "local" });
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/lock";
    redirectUrl.search = "";
    const redirect = NextResponse.redirect(redirectUrl);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    // And by name, in case the sign-out call itself failed (it leaves the
    // cookies alone then): /lock sends a signed-in request home, home would
    // send it back here, and the iPad would loop until the network returned.
    for (const { name } of request.cookies.getAll()) {
      if (name.startsWith("sb-") && name.includes("-auth-token")) redirect.cookies.delete(name);
    }
    clearSessionCookies(redirect.cookies);
    return redirect;
  }

  if (user && (isLoginPage || isLockPage)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // everything except static assets — and `/.well-known/`, which holds
    // files OTHER services fetch signed out: Apple Pay's domain-association
    // file (Square → Apple Pay → verify domain, 2026-09-22) is fetched by
    // Apple's verifier, and a redirect to /login would fail the check. The
    // web-app manifest likewise: iPadOS fetches it when the icon is added.
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|\\.well-known/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

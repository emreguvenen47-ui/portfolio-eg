import { NextResponse } from "next/server";

/**
 * Turn a thrown store error into the right status.
 *
 * `NOT_AUTHENTICATED` is a 401, not a 500: a client seeing 500 retries and
 * reports a bug, where 401 tells it to send the user to sign in. Everything
 * else keeps its 500 and its message.
 */
export function errorResponse(e: unknown, fallback = "Request failed"): NextResponse {
  const message = e instanceof Error ? e.message : fallback;
  if (message === "NOT_AUTHENTICATED") {
    return NextResponse.json({ error: "Sign in to use this." }, { status: 401 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

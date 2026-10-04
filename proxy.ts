import { NextResponse, type NextRequest } from "next/server";
import { authorizeRequest, getAuthContext } from "@/lib/auth/authorization";
import { getAuthConfigurationIssues } from "@/lib/auth/config";

const PUBLIC_PATHS = [
  "/sign-in",
  "/api/auth",
  "/api/v1/auth/config",
  "/api/v1/auth/bootstrap",
  "/api/v1/system/health",
  "/brand",
  "/legal",
  "/templates",
  "/nautex-icon-256.png",
];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestId = request.headers.get("x-request-id")?.slice(0, 128) || crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  const next = () => {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("x-request-id", requestId);
    return response;
  };
  if (isPublicPath(pathname)) return next();

  if (pathname.startsWith("/api/v1/")) {
    const authorization = await authorizeRequest(request);
    if (authorization.ok) return next();
    authorization.response.headers.set("x-request-id", requestId);
    return authorization.response;
  }

  const issues = getAuthConfigurationIssues();
  const context = issues.length ? null : await getAuthContext(request.headers);
  if (!context) {
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("callbackUrl", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    if (issues.length) signInUrl.searchParams.set("configuration", "invalid");
    return NextResponse.redirect(signInUrl);
  }

  return next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.svg|images/).*)"],
};

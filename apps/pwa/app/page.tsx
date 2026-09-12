import { redirect } from "next/navigation";
import { getCurrentEngineerSession } from "@/lib/auth/session";

/**
 * Root route (issue #168, target route renamed /workitems -> /today by
 * issue #170's Today overview): no content of its own, just routes a
 * request to wherever it belongs — signed-in engineer to `/today`, everyone
 * else (signed-out, or a non-engineer session — `getCurrentEngineerSession`
 * doesn't filter by role, so this also covers "signed in but wrong role" by
 * sending them to `/login`, where `logInAction`'s gate will reject them
 * again on the next attempt) to `/login`.
 */
export default async function RootPage() {
  const session = await getCurrentEngineerSession();
  redirect(session && session.role === "engineer" ? "/today" : "/login");
}

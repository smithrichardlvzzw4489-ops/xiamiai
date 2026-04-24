import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/get-session-user";
import { DAILY_FREE_LIMIT, utcDayString } from "@/lib/usage";

export type MeState = {
  user: { email: string } | null;
  quota: { used: number; limit: number; day: string } | null;
};

export async function getMeState(): Promise<MeState> {
  const user = await getSessionUser();
  if (!user) {
    return { user: null, quota: null };
  }
  const day = utcDayString();
  const row = await prisma.usageDay.findUnique({
    where: { userId_day: { userId: user.id, day } },
  });
  return {
    user: { email: user.email },
    quota: {
      used: row?.count ?? 0,
      limit: DAILY_FREE_LIMIT,
      day,
    },
  };
}

import { LumenStudio } from "@/components/LumenStudio";
import { getMeState } from "@/lib/me-state";

export default async function Home() {
  const initialMe = await getMeState();
  return <LumenStudio initialMe={initialMe} />;
}

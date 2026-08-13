import { RotationView } from "@/components/rotation/rotation-view";
import "@/lib/providers/register";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sector Flows" };

export default function RotationPage() {
  return <RotationView />;
}

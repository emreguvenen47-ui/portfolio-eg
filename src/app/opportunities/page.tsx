import { Scanner2 } from "@/components/scanner/scanner2";
import "@/lib/providers/register";

export const dynamic = "force-dynamic";
export const metadata = { title: "Opportunity Scanner" };

export default function OpportunitiesPage() {
  return <Scanner2 />;
}

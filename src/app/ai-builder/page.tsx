import { AiBuilder } from "@/components/ai-builder/builder";
import { isAiConfigured } from "@/lib/ai/client";

export const dynamic = "force-dynamic";

export default function AiBuilderPage() {
  return <AiBuilder aiConfigured={isAiConfigured()} />;
}

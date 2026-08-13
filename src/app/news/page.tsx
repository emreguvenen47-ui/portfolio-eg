import { Panel } from "@/components/shell/ui";
import { NewsFeed } from "@/components/news/news-feed";

export const dynamic = "force-dynamic";

export default function NewsPage() {
  return (
    <Panel
      title="News"
      subtitle="Live headlines, filtered by relevance to this book. AI interpretation is opt-in per headline."
      bodyClassName="p-0"
    >
      <NewsFeed />
    </Panel>
  );
}

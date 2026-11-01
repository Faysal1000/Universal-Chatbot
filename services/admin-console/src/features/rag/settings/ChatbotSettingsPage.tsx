import { describeError } from '@/shared/api/httpClient';
import { formatDate } from '@/shared/lib/format';
import { Card, PageHeader } from '@/shared/ui/Layout';
import { ManifestStrip } from '@/shared/ui/ManifestStrip';
import { LoadingState } from '@/shared/ui/Spinner';
import { EmptyState, ErrorBanner } from '@/shared/ui/StatusMessages';

import { useActiveChatbotSettings, useChatbotSettingsVersions } from './api/chatbotSettingsQueries';
import type { ChatbotSettingsVersion } from './api/chatbotSettingsTypes';
import { ChatbotSettingsForm } from './components/ChatbotSettingsForm';
import { SettingsVersionHistory } from './components/SettingsVersionHistory';
import { settingsVersionAuthor } from './settingsVersionModel';

export function ChatbotSettingsPage() {
  const activeSettingsQuery = useActiveChatbotSettings();
  return (
    <>
      <PageHeader title="Chatbot settings" />
      <div className="flex flex-col gap-6">
        {activeSettingsQuery.isPending ? (
          <LoadingState label="Loading settings…" />
        ) : activeSettingsQuery.isError ? (
          <ErrorBanner
            message={describeError(activeSettingsQuery.error)}
            onRetry={() => void activeSettingsQuery.refetch()}
          />
        ) : (
          <ActiveSettings activeSettings={activeSettingsQuery.data} />
        )}
        <VersionHistoryCard />
      </div>
    </>
  );
}

function ActiveSettings({ activeSettings }: { activeSettings: ChatbotSettingsVersion }) {
  return (
    <>
      <ManifestStrip
        fields={[
          { label: 'Active version', value: `v${activeSettings.version}` },
          {
            label: 'Saved',
            value: formatDate(activeSettings.createdAt),
            note: `by ${settingsVersionAuthor(activeSettings)}`,
          },
        ]}
      />
      <Card title="Settings" description={`Based on version ${activeSettings.version}`}>
        <ChatbotSettingsForm key={activeSettings.version} activeSettings={activeSettings} />
      </Card>
    </>
  );
}

function VersionHistoryCard() {
  const versionsQuery = useChatbotSettingsVersions();
  return (
    <Card title="Version history" bodyClassName="p-0">
      {versionsQuery.isPending ? (
        <LoadingState label="Loading versions…" />
      ) : versionsQuery.isError ? (
        <div className="p-4">
          <ErrorBanner message={describeError(versionsQuery.error)} onRetry={() => void versionsQuery.refetch()} />
        </div>
      ) : versionsQuery.data.length === 0 ? (
        <EmptyState title="No saved versions" />
      ) : (
        <SettingsVersionHistory versions={versionsQuery.data} />
      )}
    </Card>
  );
}

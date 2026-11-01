import { Link, useNavigate } from 'react-router';

import { describeError } from '@/shared/api/httpClient';
import { ROUTE_PATHS, providerEditorPath } from '@/shared/routePaths';
import { Button } from '@/shared/ui/Button';
import { Card, PageHeader } from '@/shared/ui/Layout';
import { LoadingState } from '@/shared/ui/Spinner';
import { EmptyState, ErrorBanner, StatusBadge } from '@/shared/ui/StatusMessages';
import { DataCell, HeaderCell, Table } from '@/shared/ui/Table';
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch';
import { useToast } from '@/shared/ui/toastContext';

import { useProviders, useUpdateProvider } from './api/providerQueries';
import type { ProviderResponse } from './api/providerTypes';
import { API_PROTOCOL_LABELS } from './protocols';

export function ProvidersPage() {
  const providersQuery = useProviders();
  const navigate = useNavigate();
  const addProviderButton = (
    <Button variant="primary" onClick={() => void navigate(ROUTE_PATHS.newProvider)}>
      Add provider
    </Button>
  );

  return (
    <>
      <PageHeader title="Providers" actions={addProviderButton} />
      {providersQuery.isPending ? (
        <LoadingState label="Loading providers…" />
      ) : providersQuery.isError ? (
        <ErrorBanner
          title="Could not load providers"
          message={describeError(providersQuery.error)}
          onRetry={() => void providersQuery.refetch()}
        />
      ) : providersQuery.data.length === 0 ? (
        <Card>
          <EmptyState
            title="No providers yet"
            description="Add a provider, then its models."
            action={addProviderButton}
          />
        </Card>
      ) : (
        <Card bodyClassName="p-0">
          <Table caption="Providers">
            <thead>
              <tr>
                <HeaderCell>Provider</HeaderCell>
                <HeaderCell>Protocol</HeaderCell>
                <HeaderCell>Base URL</HeaderCell>
                <HeaderCell isNumeric>Models</HeaderCell>
                <HeaderCell>Enabled</HeaderCell>
                <HeaderCell>
                  <span className="sr-only">Actions</span>
                </HeaderCell>
              </tr>
            </thead>
            <tbody>
              {providersQuery.data.map((provider) => (
                <ProviderRow key={provider.provider_id} provider={provider} />
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}

function ProviderRow({ provider }: { provider: ProviderResponse }) {
  const updateProviderMutation = useUpdateProvider();
  const { showToast } = useToast();
  const enabledModelCount = provider.models.filter((model) => model.is_enabled).length;

  const toggleEnabled = (isEnabled: boolean) => {
    updateProviderMutation.mutate(
      { providerId: provider.provider_id, request: { is_enabled: isEnabled } },
      {
        onSuccess: () => showToast(`${provider.display_name} ${isEnabled ? 'enabled' : 'disabled'}.`, 'success'),
        onError: (error) => showToast(describeError(error), 'error'),
      },
    );
  };

  return (
    <tr className="hover:bg-surface-hover">
      <DataCell>
        <Link to={providerEditorPath(provider.provider_id)} className="font-medium text-primary hover:underline">
          {provider.display_name}
        </Link>
        <p className="font-mono text-xs text-muted">{provider.provider_id}</p>
        {provider.has_api_key ? null : <StatusBadge tone="warning" label="No API key" />}
      </DataCell>
      <DataCell className="whitespace-nowrap">{API_PROTOCOL_LABELS[provider.api_protocol]}</DataCell>
      <DataCell className="max-w-64 truncate font-mono text-xs" title={provider.base_url}>
        {provider.base_url}
      </DataCell>
      <DataCell isNumeric>
        {enabledModelCount === provider.models.length
          ? provider.models.length
          : `${enabledModelCount} of ${provider.models.length}`}
      </DataCell>
      <DataCell>
        <ToggleSwitch
          isOn={provider.is_enabled}
          onChange={toggleEnabled}
          disabled={updateProviderMutation.isPending}
          label={`Enable ${provider.display_name}`}
          isLabelVisuallyHidden
        />
      </DataCell>
      <DataCell className="text-right">
        <Link
          to={providerEditorPath(provider.provider_id)}
          className="rounded-md px-2 py-1 text-sm text-accent hover:bg-surface-hover"
        >
          Edit
        </Link>
      </DataCell>
    </tr>
  );
}

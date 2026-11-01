import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { ApiError, describeError } from '@/shared/api/httpClient';
import { splitApiError } from '@/shared/lib/fieldErrors';
import type { FieldErrorMessages } from '@/shared/lib/fieldErrors';
import { ROUTE_PATHS, providerEditorPath } from '@/shared/routePaths';
import { Button } from '@/shared/ui/Button';
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog';
import { Card, PageHeader } from '@/shared/ui/Layout';
import { LoadingState } from '@/shared/ui/Spinner';
import { ErrorBanner } from '@/shared/ui/StatusMessages';
import { useToast } from '@/shared/ui/toastContext';

import { useCreateProvider, useDeleteProvider, useProvider, useUpdateProvider } from './api/providerQueries';
import type { ProviderResponse } from './api/providerTypes';
import { ProviderForm } from './components/ProviderForm';
import { ProviderModelsSection } from './components/ProviderModelsSection';
import { PROVIDER_FORM_FIELD_NAMES, toProviderCreateRequest, toProviderUpdateRequest } from './providerFormModel';
import type { ProviderFormValues } from './providerFormModel';

/** Create (`/providers/new`) or edit (`/providers/:providerId`) a provider and its models. */
export function ProviderEditorPage() {
  const { providerId } = useParams<{ providerId: string }>();
  const providerQuery = useProvider(providerId);
  const backLink = (
    <Link to={ROUTE_PATHS.providers} className="inline-flex items-center gap-1 text-sm text-muted hover:text-primary">
      <ArrowLeft aria-hidden="true" className="size-3.5" />
      All providers
    </Link>
  );

  if (providerId === undefined) {
    return (
      <>
        {backLink}
        <PageHeader title="Add provider" />
        <ProviderEditor provider={undefined} />
      </>
    );
  }
  if (providerQuery.isPending) return <LoadingState label="Loading provider…" />;
  if (providerQuery.isError) {
    return (
      <>
        {backLink}
        <div className="mt-4">
          <ErrorBanner
            title="Could not load the provider"
            message={describeError(providerQuery.error)}
            onRetry={
              providerQuery.error instanceof ApiError && providerQuery.error.httpStatus === 404
                ? undefined
                : () => void providerQuery.refetch()
            }
          />
        </div>
      </>
    );
  }
  const provider = providerQuery.data;
  return (
    <>
      {backLink}
      <PageHeader title={provider.display_name} />
      <div className="flex flex-col gap-6">
        {/* Re-mount the form whenever the server copy changes so it shows the saved state. */}
        <ProviderEditor key={provider.updated_at} provider={provider} />
        <ProviderModelsSection provider={provider} />
        <DeleteProviderCard provider={provider} />
      </div>
    </>
  );
}

function ProviderEditor({ provider }: { provider: ProviderResponse | undefined }) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const createProviderMutation = useCreateProvider();
  const updateProviderMutation = useUpdateProvider();
  const [serverFieldErrors, setServerFieldErrors] = useState<FieldErrorMessages>({});
  const [serverErrorMessage, setServerErrorMessage] = useState<string | null>(null);

  const handleError = (error: unknown) => {
    if (error instanceof ApiError && error.httpStatus === 409) {
      setServerFieldErrors({ provider_id: error.message });
      setServerErrorMessage(null);
      return;
    }
    const { fieldErrors, generalMessage } = splitApiError(error, PROVIDER_FORM_FIELD_NAMES);
    setServerFieldErrors(fieldErrors);
    setServerErrorMessage(generalMessage);
  };

  const handleSubmit = (values: ProviderFormValues) => {
    setServerFieldErrors({});
    setServerErrorMessage(null);
    if (provider === undefined) {
      createProviderMutation.mutate(toProviderCreateRequest(values), {
        onSuccess: (createdProvider) => {
          showToast(`Provider ${createdProvider.display_name} created. Add its models next.`, 'success');
          void navigate(providerEditorPath(createdProvider.provider_id), { replace: true });
        },
        onError: handleError,
      });
    } else {
      updateProviderMutation.mutate(
        { providerId: provider.provider_id, request: toProviderUpdateRequest(values, provider) },
        {
          onSuccess: () => showToast('Provider saved.', 'success'),
          onError: handleError,
        },
      );
    }
  };

  return (
    <ProviderForm
      provider={provider}
      isSubmitting={createProviderMutation.isPending || updateProviderMutation.isPending}
      serverFieldErrors={serverFieldErrors}
      serverErrorMessage={serverErrorMessage}
      onSubmit={handleSubmit}
      onCancel={() => void navigate(ROUTE_PATHS.providers)}
    />
  );
}

function DeleteProviderCard({ provider }: { provider: ProviderResponse }) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const deleteProviderMutation = useDeleteProvider();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  const confirmDelete = () => {
    deleteProviderMutation.mutate(provider.provider_id, {
      onSuccess: () => {
        showToast(`Provider ${provider.display_name} deleted.`, 'success');
        void navigate(ROUTE_PATHS.providers, { replace: true });
      },
    });
  };

  return (
    <Card title="Delete provider" description="Removes its credentials and models too.">
      <Button
        variant="danger"
        onClick={() => {
          deleteProviderMutation.reset();
          setIsConfirmOpen(true);
        }}
      >
        Delete {provider.display_name}
      </Button>
      <ConfirmDialog
        isOpen={isConfirmOpen}
        title={`Delete ${provider.display_name}?`}
        message={
          <p>
            This removes the provider <span className="font-mono">{provider.provider_id}</span> and its{' '}
            {provider.models.length} model(s). Providers whose models are used by a task route or as the default model
            cannot be deleted.
          </p>
        }
        confirmLabel="Delete provider"
        isConfirming={deleteProviderMutation.isPending}
        errorMessage={deleteProviderMutation.isError ? describeError(deleteProviderMutation.error) : null}
        onConfirm={confirmDelete}
        onCancel={() => setIsConfirmOpen(false)}
      />
    </Card>
  );
}

import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';

import { ApiError, describeError } from '@/shared/api/httpClient';
import { withBasePath } from '@/shared/basePath';
import { ROUTE_PATHS } from '@/shared/routePaths';
import { Button } from '@/shared/ui/Button';
import { TextField } from '@/shared/ui/FormFields';
import { LoadingState } from '@/shared/ui/Spinner';
import { ErrorBanner } from '@/shared/ui/StatusMessages';

import { useCurrentSession, useSignIn } from './api/sessionQueries';

function readReturnPath(locationState: unknown): string {
  if (typeof locationState === 'object' && locationState !== null && 'returnPath' in locationState) {
    const { returnPath } = locationState;
    if (typeof returnPath === 'string' && returnPath.startsWith('/') && !returnPath.startsWith('//')) return returnPath;
  }
  return ROUTE_PATHS.overview;
}

function describeSignInError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.httpStatus === 401) return 'Incorrect username or password.';
    if (error.httpStatus === 429) return 'Too many sign-in attempts. Please wait a few minutes and try again.';
  }
  return describeError(error);
}

export function LoginPage() {
  const sessionQuery = useCurrentSession();
  const signInMutation = useSignIn();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const returnPath = readReturnPath(location.state);

  if (sessionQuery.isPending) return <LoadingState label="Checking session…" />;
  if (sessionQuery.data) return <Navigate to={returnPath} replace />;

  const handleSubmit = (submitEvent: SubmitEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    signInMutation.mutate(
      { username: username.trim(), password },
      { onSuccess: () => void navigate(returnPath, { replace: true }) },
    );
  };

  return (
    <main className="flex min-h-full items-center justify-center bg-page px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-5 flex items-center gap-3">
          <img src={withBasePath('/favicon.svg')} alt="" className="size-9" />
          <h1 className="text-lg font-semibold text-primary">Universal Chatbot admin console</h1>
        </div>
        <form
          onSubmit={handleSubmit}
          aria-label="Sign in"
          className="flex flex-col gap-4 rounded-md border border-border bg-surface p-6"
        >
          {signInMutation.isError ? <ErrorBanner message={describeSignInError(signInMutation.error)} /> : null}
          <TextField
            label="Username"
            name="username"
            autoComplete="username"
            required
            maxLength={128}
            value={username}
            onChange={(changeEvent) => setUsername(changeEvent.target.value)}
          />
          <TextField
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={1024}
            value={password}
            onChange={(changeEvent) => setPassword(changeEvent.target.value)}
          />
          <Button
            type="submit"
            variant="primary"
            isLoading={signInMutation.isPending}
            disabled={!username.trim() || !password}
          >
            Sign in
          </Button>
        </form>
      </div>
    </main>
  );
}

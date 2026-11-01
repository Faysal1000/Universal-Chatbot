import { useState } from 'react';

import type { ModelChainRequest, TaskRouteResponse } from './api/routingTypes';
import {
  NO_CHAIN_ERRORS,
  chainErrorsFromApiError,
  chainStepsFrom,
  hasChainErrors,
  toModelChainRequest,
  validateChainSteps,
} from './chainFormModel';
import type { ChainStepValues, ChainValidationErrors } from './chainFormModel';

/** New routes fall back to the default model unless the admin turns it off. */
const NEW_ROUTE_APPENDS_DEFAULT_MODEL = true;

export interface RouteChainDraft {
  steps: ChainStepValues[];
  setSteps: (steps: ChainStepValues[]) => void;
  appendDefaultModel: boolean;
  setAppendDefaultModel: (isOn: boolean) => void;
  chainErrors: ChainValidationErrors;
  /** Runs the client-side checks, shows their messages, and says whether the chain may be sent. */
  validate: (isModelAllowed: (modelPk: number) => boolean) => boolean;
  /** Shows a 422 from the gateway next to the rows; returns false when the error is not about the chain. */
  showServerErrors: (error: unknown) => boolean;
  toRequest: () => ModelChainRequest;
}

/** Editable copy of a route's chain (or an empty one-step chain for a new route). */
export function useRouteChainDraft(route: TaskRouteResponse | undefined): RouteChainDraft {
  const [steps, setSteps] = useState<ChainStepValues[]>(() => chainStepsFrom(route));
  const [appendDefaultModel, setAppendDefaultModel] = useState(
    route?.append_default_model ?? NEW_ROUTE_APPENDS_DEFAULT_MODEL,
  );
  const [chainErrors, setChainErrors] = useState<ChainValidationErrors>(NO_CHAIN_ERRORS);

  return {
    steps,
    setSteps,
    appendDefaultModel,
    setAppendDefaultModel,
    chainErrors,
    validate: (isModelAllowed) => {
      const validationErrors = validateChainSteps(steps, isModelAllowed);
      setChainErrors(validationErrors);
      return !hasChainErrors(validationErrors);
    },
    showServerErrors: (error) => {
      const serverErrors = chainErrorsFromApiError(error, steps);
      setChainErrors(serverErrors ?? NO_CHAIN_ERRORS);
      return serverErrors !== null && hasChainErrors(serverErrors);
    },
    toRequest: () => toModelChainRequest(steps, appendDefaultModel),
  };
}

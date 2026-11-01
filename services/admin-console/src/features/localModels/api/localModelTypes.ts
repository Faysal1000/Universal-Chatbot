/**
 * Admin API types of `services/local-llm` (`/admin/v1`), taken from its generated OpenAPI
 * contract plus the validation limits of `app/schemas/admin.py` and `app/deployments/models.py`.
 */
import type { components } from '@/contracts/local-llm';

type LocalLlmSchemas = components['schemas'];

export type Deployment = LocalLlmSchemas['DeploymentView'];
export type DeploymentList = LocalLlmSchemas['DeploymentList'];
export type DeploymentStatus = LocalLlmSchemas['DeploymentStatus'];
export type DeploymentCreateRequest = LocalLlmSchemas['DeploymentCreateRequest'];
export type DeploymentUpdateRequest = LocalLlmSchemas['DeploymentUpdateRequest'];
export type SystemView = LocalLlmSchemas['SystemView'];
export type DeviceBudget = LocalLlmSchemas['DeviceBudgetView'];
export type DeviceRequest = Deployment['device'];
export type ResolvedDevice = NonNullable<Deployment['resolved_device']>;
export type EngineKind = NonNullable<Deployment['engine']>;
export type ModelDtype = DeploymentCreateRequest['dtype'];
type ConfiguredSettings = LocalLlmSchemas['ConfiguredSettingsView'];
export type ReasoningControl = ConfiguredSettings['reasoning_control'];
export type RegisteredReasoningControl = NonNullable<Deployment['reasoning_control']>;

/** `DEPLOYMENT_NAME_PATTERN`: the name is also the model the gateway calls. */
export const DEPLOYMENT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const MAXIMUM_DEPLOYMENT_NAME_LENGTH = 128;
/** `MODEL_ID_PATTERN`: `org/repo`, or `org/repo:QUANT` for a GGUF repository. */
export const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*(:[A-Za-z0-9_.-]+)?$/;
/** `TASK_NAME_PATTERN`: the gateway's task names. */
export const TASK_NAME_PATTERN = /^[a-z][a-z0-9_.-]{0,62}$/;

export const MAXIMUM_MODEL_ID_LENGTH = 200;
export const MAXIMUM_REVISION_LENGTH = 100;
export const MAXIMUM_DISPLAY_NAME_LENGTH = 200;
export const MAXIMUM_DEFAULT_TASK_COUNT = 50;
export const MINIMUM_CONTEXT_WINDOW_TOKENS = 256;
export const MINIMUM_MAX_OUTPUT_TOKENS = 1;
export const MAXIMUM_TOKEN_LIMIT = 1_048_576;

export const DEVICE_REQUESTS: readonly DeviceRequest[] = ['auto', 'gpu', 'cpu'];
export const MODEL_DTYPES: readonly ModelDtype[] = ['auto', 'bfloat16', 'float16', 'float32'];
export const REASONING_CONTROLS: readonly ReasoningControl[] = ['auto', 'reasoning_effort', 'enable_thinking'];

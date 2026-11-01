import { Global, Module } from '@nestjs/common';

import { LANGUAGE_MODEL_PORT } from '../../ports/language-model.port.js';
import { LlmGatewayAdapter } from './llm-gateway.adapter.js';

@Global()
@Module({
  providers: [{ provide: LANGUAGE_MODEL_PORT, useClass: LlmGatewayAdapter }],
  exports: [LANGUAGE_MODEL_PORT],
})
export class LlmGatewayModule {}

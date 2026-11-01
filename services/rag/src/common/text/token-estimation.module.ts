import { Global, Module } from '@nestjs/common';

import type { ServiceConfiguration } from '../../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../../config/configuration.module.js';
import { TokenEstimator } from '../../domain/text/token-estimator.js';

@Global()
@Module({
  providers: [
    {
      provide: TokenEstimator,
      inject: [SERVICE_CONFIGURATION],
      useFactory: (configuration: ServiceConfiguration) =>
        new TokenEstimator(configuration.chat.tokenEstimateSafetyFactor),
    },
  ],
  exports: [TokenEstimator],
})
export class TokenEstimationModule {}

import { type DynamicModule, Global, Module } from '@nestjs/common';

import type { ServiceConfiguration } from './configuration.js';

/** Injection token for the validated, immutable {@link ServiceConfiguration}. */
export const SERVICE_CONFIGURATION = Symbol('SERVICE_CONFIGURATION');

/**
 * Provides the configuration parsed once by the entry point. Taking it as an argument
 * (instead of reading `process.env` here) lets tests boot the real modules with an
 * explicit configuration.
 */
@Global()
@Module({})
export class ConfigurationModule {
  static forConfiguration(configuration: ServiceConfiguration): DynamicModule {
    return {
      module: ConfigurationModule,
      providers: [{ provide: SERVICE_CONFIGURATION, useValue: configuration }],
      exports: [SERVICE_CONFIGURATION],
    };
  }
}

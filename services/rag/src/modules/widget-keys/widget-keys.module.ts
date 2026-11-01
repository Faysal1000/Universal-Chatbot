import { Module } from '@nestjs/common';

import { WidgetAccessPolicy } from './widget-access.policy.js';
import { WidgetKeysRepository } from './widget-keys.repository.js';

/** Publishable keys of the website widget and the origin checks the public API applies with them. */
@Module({
  providers: [WidgetKeysRepository, WidgetAccessPolicy],
  exports: [WidgetKeysRepository, WidgetAccessPolicy],
})
export class WidgetKeysModule {}

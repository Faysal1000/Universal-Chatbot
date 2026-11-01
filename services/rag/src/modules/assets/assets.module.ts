import { Module } from '@nestjs/common';

import { AssetsController } from './assets.controller.js';
import { SignedAssetUrls } from './signed-asset-urls.js';

@Module({ controllers: [AssetsController], providers: [SignedAssetUrls], exports: [SignedAssetUrls] })
export class AssetsModule {}

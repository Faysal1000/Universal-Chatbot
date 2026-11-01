import { Controller, Get, Inject, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { sendStoredFile } from '../../common/http/stored-file-response.js';
import { OBJECT_STORAGE_PORT, type ObjectStoragePort } from '../../ports/object-storage.port.js';
import { SignedAssetUrls } from './signed-asset-urls.js';

@ApiTags('Public: assets')
@Controller('v1/public/assets')
export class AssetsController {
  constructor(
    private readonly signedAssetUrls: SignedAssetUrls,
    @Inject(OBJECT_STORAGE_PORT) private readonly objectStorage: ObjectStoragePort,
  ) {}

  @Get(':token')
  @ApiOperation({
    summary: 'A stored image behind a signed, short-lived URL',
    description: 'URLs come from attachments and citation previews; they expire after a few minutes.',
  })
  @ApiProduces('image/png', 'image/jpeg', 'image/webp')
  async send(@Param('token') token: string, @Res() response: Response): Promise<void> {
    const claims = this.signedAssetUrls.verify(token);
    const storedFile = await this.objectStorage.openReadStream(claims.key);
    const secondsLeft = Math.max(0, claims.expiresAtSeconds - Math.floor(Date.now() / 1_000));
    await sendStoredFile(
      response,
      { ...storedFile, contentType: claims.contentType },
      { maxAgeSeconds: secondsLeft },
    );
  }
}

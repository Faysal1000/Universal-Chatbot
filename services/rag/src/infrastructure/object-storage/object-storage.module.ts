import { S3Client } from '@aws-sdk/client-s3';
import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';

import type { ServiceConfiguration } from '../../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../../config/configuration.module.js';
import { OBJECT_STORAGE_PORT } from '../../ports/object-storage.port.js';
import { ObjectStorageHealthCheck } from './object-storage.health-check.js';
import { OBJECT_STORAGE_CLIENT } from './object-storage.tokens.js';
import { S3ObjectStorageAdapter } from './s3-object-storage.adapter.js';

function createObjectStorageClient(configuration: ServiceConfiguration): S3Client {
  const { objectStorage } = configuration;
  return new S3Client({
    region: objectStorage.region,
    ...(objectStorage.endpoint === undefined ? {} : { endpoint: objectStorage.endpoint }),
    forcePathStyle: objectStorage.forcePathStyle,
    credentials: {
      accessKeyId: objectStorage.accessKeyId.reveal(),
      secretAccessKey: objectStorage.secretAccessKey.reveal(),
    },
    maxAttempts: 3,
  });
}

@Global()
@Module({
  providers: [
    {
      provide: OBJECT_STORAGE_CLIENT,
      inject: [SERVICE_CONFIGURATION],
      useFactory: createObjectStorageClient,
    },
    { provide: OBJECT_STORAGE_PORT, useClass: S3ObjectStorageAdapter },
    ObjectStorageHealthCheck,
  ],
  exports: [OBJECT_STORAGE_PORT, ObjectStorageHealthCheck],
})
export class ObjectStorageModule implements OnApplicationShutdown {
  constructor(@Inject(OBJECT_STORAGE_CLIENT) private readonly s3Client: S3Client) {}

  onApplicationShutdown(): void {
    this.s3Client.destroy();
  }
}

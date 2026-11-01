import { HeadBucketCommand, type S3Client } from '@aws-sdk/client-s3';
import { Inject, Injectable } from '@nestjs/common';

import type { ServiceConfiguration } from '../../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../../config/configuration.module.js';
import type { DependencyHealthCheck } from '../../health/dependency-health-check.js';
import { OBJECT_STORAGE_CLIENT } from './object-storage.tokens.js';

@Injectable()
export class ObjectStorageHealthCheck implements DependencyHealthCheck {
  readonly dependencyName = 'object_storage';

  constructor(
    @Inject(OBJECT_STORAGE_CLIENT) private readonly s3Client: S3Client,
    @Inject(SERVICE_CONFIGURATION) private readonly configuration: ServiceConfiguration,
  ) {}

  async check(): Promise<void> {
    // Verifies reachability, credentials and that the bucket exists in one call.
    await this.s3Client.send(new HeadBucketCommand({ Bucket: this.configuration.objectStorage.bucket }));
  }
}

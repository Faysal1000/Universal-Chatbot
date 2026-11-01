import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';

import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { ApplicationError } from '../../../common/errors/application-error.js';
import { receiveMultipartFile } from '../../../common/http/multipart-file-receiver.js';
import type { ServiceConfiguration } from '../../../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../../../config/configuration.module.js';
import { OBJECT_STORAGE_PORT, type ObjectStoragePort } from '../../../ports/object-storage.port.js';
import { SignedAssetUrls } from '../../assets/signed-asset-urls.js';
import { documentStorageKeys } from '../../documents/document-storage-keys.js';
import type { VisitorPrincipal } from '../../public-access/visitor-principal.js';
import {
  type ChatAttachmentRecord,
  ChatAttachmentsRepository,
} from '../persistence/chat-attachments.repository.js';
import { normaliseVisitorImage } from './image-normaliser.js';

/** An upload not used in a turn within this time is deleted. */
const UNBOUND_ATTACHMENT_LIFETIME_MILLISECONDS = 60 * 60_000;
/** Signed image URLs in API responses; clients refetch the message for a fresh one. */
const ATTACHMENT_URL_LIFETIME_SECONDS = 10 * 60;

export interface AttachmentView {
  readonly id: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly width: number;
  readonly height: number;
  readonly url: string;
  readonly expiresAt: string;
}

/** Visitor image uploads: validated, re-encoded and stored before any turn uses them. */
@Injectable()
export class ChatAttachmentsService {
  constructor(
    private readonly chatAttachmentsRepository: ChatAttachmentsRepository,
    private readonly signedAssetUrls: SignedAssetUrls,
    @Inject(OBJECT_STORAGE_PORT) private readonly objectStorage: ObjectStoragePort,
    @Inject(SERVICE_CONFIGURATION) private readonly configuration: ServiceConfiguration,
  ) {}

  async upload(request: Request, visitor: VisitorPrincipal): Promise<AttachmentView> {
    const uploadedBytes = await this.receiveImageBytes(request);
    const image = await normaliseVisitorImage(uploadedBytes);
    const attachmentId = randomUUID();
    const storageKey = documentStorageKeys.attachment(attachmentId);
    await this.objectStorage.putBytes(storageKey, image.bytes, image.mimeType);
    const attachment = await this.chatAttachmentsRepository.insert({
      id: attachmentId,
      visitorSessionId: visitor.visitorSessionId,
      storageKey,
      mimeType: image.mimeType,
      byteSize: image.bytes.length,
      widthPixels: image.widthPixels,
      heightPixels: image.heightPixels,
      expiresAt: new Date(Date.now() + UNBOUND_ATTACHMENT_LIFETIME_MILLISECONDS),
    });
    return this.present(attachment);
  }

  present(attachment: ChatAttachmentRecord): AttachmentView {
    const signedUrl = this.signedAssetUrls.sign(
      attachment.storageKey,
      attachment.mimeType,
      ATTACHMENT_URL_LIFETIME_SECONDS,
    );
    return {
      id: attachment.id,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.byteSize,
      width: attachment.widthPixels,
      height: attachment.heightPixels,
      url: signedUrl.url,
      expiresAt: signedUrl.expiresAt.toISOString(),
    };
  }

  private async receiveImageBytes(request: Request): Promise<Buffer> {
    const chunks: Buffer[] = [];
    try {
      await receiveMultipartFile(request, {
        fileFieldName: 'file',
        maximumFileBytes: this.configuration.chat.maxAttachmentBytes,
        storeFile: (fileStream) => collectInto(fileStream, chunks),
      });
    } catch (error: unknown) {
      if (error instanceof ApplicationError && error.code === 'payload_too_large') {
        throw new ApplicationError(
          413,
          'attachment_too_large',
          `Images may be at most ${this.configuration.chat.maxAttachmentBytes} bytes.`,
        );
      }
      throw error;
    }
    return Buffer.concat(chunks);
  }
}

async function collectInto(fileStream: Readable, chunks: Buffer[]): Promise<void> {
  for await (const chunk of fileStream) chunks.push(chunk as Buffer);
}

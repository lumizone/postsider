import { CloudflareStorage } from './cloudflare.storage';
import { MinioStorage } from './minio.storage';
import { IUploadProvider } from './upload.interface';
import { LocalStorage } from './local.storage';

export class UploadFactory {
  static createStorage(): IUploadProvider {
    const storageProvider = process.env.STORAGE_PROVIDER || 'local';

    switch (storageProvider) {
      case 'local':
        return new LocalStorage(process.env.UPLOAD_DIRECTORY!);
      case 'cloudflare':
        return new CloudflareStorage(
          process.env.CLOUDFLARE_ACCOUNT_ID!,
          process.env.CLOUDFLARE_ACCESS_KEY!,
          process.env.CLOUDFLARE_SECRET_ACCESS_KEY!,
          process.env.CLOUDFLARE_REGION!,
          process.env.CLOUDFLARE_BUCKETNAME!,
          process.env.CLOUDFLARE_BUCKET_URL!
        );
      case 'minio':
        return new MinioStorage(
          process.env.MINIO_ENDPOINT!,
          process.env.MINIO_ACCESS_KEY!,
          process.env.MINIO_SECRET_KEY!,
          process.env.MINIO_BUCKET!,
          process.env.MINIO_PUBLIC_URL!
        );
      default:
        throw new Error(`Invalid storage type ${storageProvider}`);
    }
  }
}

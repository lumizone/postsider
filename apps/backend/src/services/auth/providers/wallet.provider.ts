import {
  AuthProvider,
  AuthProviderAbstract,
} from '@postsider/backend/services/auth/providers.interface';
import { randomBytes } from 'crypto';
import { ioRedis } from '@postsider/nestjs-libraries/redis/redis.service';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

function hexToUint8Array(hex: string) {
  if (hex.startsWith('0x')) {
    hex = hex.slice(2);
  }

  if (hex.length % 2 !== 0) {
    throw new Error('Invalid hex string. It must have an even length.');
  }

  const byteLength = hex.length / 2;
  const uint8Array = new Uint8Array(byteLength);

  for (let i = 0; i < byteLength; i++) {
    const byteHex = hex.substr(i * 2, 2);
    uint8Array[i] = parseInt(byteHex, 16);
  }

  return uint8Array;
}

@AuthProvider({ provider: 'WALLET' })
export class WalletProvider extends AuthProviderAbstract {
  async generateLink(params: { publicKey: string }): Promise<string> {
    if (!params.publicKey) {
      throw new Error('Missing public key');
    }

    const challenge = randomBytes(32).toString('hex');
    await ioRedis.set(`wallet:${params.publicKey}`, challenge, 'EX', 60);

    return challenge;
  }

  // Stateless signature check. The challenge travels inside the signed payload,
  // so verification does not depend on Redis state (which getUser may consume).
  private verifySignature(
    code: string
  ): { publicKey: string; challenge: string } | null {
    try {
      const { publicKey, challenge, signature } = JSON.parse(
        Buffer.from(code, 'base64').toString()
      );

      if (!publicKey || !challenge || !signature) {
        return null;
      }

      const publicKeyUint8 = bs58.decode(publicKey);
      const messageUint8 = new TextEncoder().encode(challenge);
      const signatureUint8 = hexToUint8Array(signature);
      const isValid = nacl.sign.detached.verify(
        messageUint8,
        signatureUint8,
        publicKeyUint8
      );

      return isValid ? { publicKey, challenge } : null;
    } catch {
      return null;
    }
  }

  async getToken(code: string, _redirectUri?: string) {
    const verified = this.verifySignature(code);
    if (!verified) {
      return '';
    }

    const redisGet = await ioRedis.get(`wallet:${verified.publicKey}`);
    if (redisGet !== verified.challenge) {
      return '';
    }

    return code;
  }

  async getUser(providerToken: string) {
    const verified = this.verifySignature(providerToken);
    if (!verified) {
      return false;
    }

    // Single-use: the challenge must still be present and is consumed on the
    // first successful verification, so a captured signature cannot be replayed
    // within the TTL window. (loginOrRegisterProvider calls getUser directly,
    // so the consumption cannot live in getToken alone.)
    const stored = await ioRedis.get(`wallet:${verified.publicKey}`);
    if (stored !== verified.challenge) {
      return false;
    }
    await ioRedis.del(`wallet:${verified.publicKey}`);

    return {
      id: String(`wallet_${verified.publicKey}`),
      email: String(`wallet_${verified.publicKey}`),
    };
  }
}

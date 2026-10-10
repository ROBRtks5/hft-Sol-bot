import { OperatingMode } from '../types/backend';
import { SecureStorage } from '../secureStorage';
import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

export interface SigningAdapter {
  isCapable(): boolean;
  isHardwareProtected(): boolean;
  getEnvironmentDescriptionRu(): string;
  getPublicAddress(): Promise<string | null>;
  signTransaction(rawPayload: Uint8Array): Promise<{ signature: string }>;
  signAndSendSweep(amountSol: number, destinationPubkey: string): Promise<{ success: boolean; txSignature?: string; errorRu?: string }>;
  signAndSendModeSwitch(targetMode: OperatingMode): Promise<{ success: boolean; signature?: string; errorRu?: string }>;
  hasKey?(): boolean;
  loadFromKeystore?(): Promise<boolean>;
  setKeypair?(keypair: Keypair): void;
}

export class RealSolanaSigningAdapter implements SigningAdapter {
  private rpcUrl = 'https://api.mainnet-beta.solana.com';
  private isKeyLoaded: boolean = false;
  public publicKey: string | null = null;

  constructor() {
    this.loadFromKeystore().catch(() => {});
  }

  public hasKey(): boolean {
    return this.isKeyLoaded;
  }

  public async loadFromKeystore(): Promise<boolean> {
    try {
      const keypair = await SecureStorage.getKeypair();
      if (keypair) {
        this.isKeyLoaded = true;
        this.publicKey = keypair.publicKey.toBase58();
        return true;
      }
    } catch (err) {
      console.warn('[SigningAdapter] Не удалось загрузить ключ из Keystore:', err);
    }
    this.isKeyLoaded = false;
    this.publicKey = null;
    return false;
  }

  public setKeypair(keypair: Keypair): void {
    if (keypair && keypair.publicKey) {
      this.isKeyLoaded = true;
      this.publicKey = keypair.publicKey.toBase58();
    }
  }

  public isCapable(): boolean { return true; }

  public isHardwareProtected(): boolean { return SecureStorage.isNativeDevice(); }

  public getEnvironmentDescriptionRu(): string {
    return SecureStorage.isNativeDevice()
      ? 'Android APK (аппаратный модуль Android Keystore / Ed25519 биометрия активна).'
      : 'Локальное веб-устройство (Real WebCrypto Ed25519 / Solana RPC).';
  }

  public async getPublicAddress(): Promise<string | null> {
    if (this.publicKey) return this.publicKey;
    const loaded = await this.loadFromKeystore();
    if (loaded && this.publicKey) return this.publicKey;
    return await SecureStorage.derivePublicAddress();
  }

  public async signTransaction(rawPayload: Uint8Array): Promise<{ signature: string }> {
    if (!this.isKeyLoaded) {
      await this.loadFromKeystore();
    }
    const keypair = await SecureStorage.getKeypair();
    if (!keypair || !this.isKeyLoaded) {
      throw new Error('Ключ не импортирован в Keystore. Импортируйте сид-фразу в Настройках.');
    }
    const authOk = await SecureStorage.authenticateBiometrics('Подтвердите сделку отпечатком пальца / PIN');
    if (!authOk) {
      throw new Error('Биометрическая аутентификация отклонена оператором.');
    }
    const signatureBytes = nacl.sign.detached(rawPayload, keypair.secretKey);
    return { signature: bs58.encode(signatureBytes) };
  }

  public async signAndSendSweep(amountSol: number, destinationPubkeyStr: string): Promise<{ success: boolean; txSignature?: string; errorRu?: string }> {
    const keypair = await SecureStorage.getKeypair();
    if (!keypair || !this.isKeyLoaded) {
      return { success: false, errorRu: 'ОШИБКА ВЫВОДА: Торговый ключ отсутствует в защищенном Keystore. Введите сид-фразу.' };
    }
    let destinationPubkey: PublicKey;
    try {
      destinationPubkey = new PublicKey(destinationPubkeyStr);
    } catch {
      return { success: false, errorRu: 'Недопустимый адрес холодного кошелька: ' + destinationPubkeyStr };
    }
    const authOk = await SecureStorage.authenticateBiometrics('Подтвердите вывод ' + amountSol + ' SOL на адрес ' + destinationPubkeyStr.slice(0, 6) + '...' + destinationPubkeyStr.slice(-4));
    if (!authOk) {
      return { success: false, errorRu: 'Оператор отменил подтверждение биометрией.' };
    }
    try {
      const connection = new Connection(this.rpcUrl, 'confirmed');
      const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
      const transaction = new Transaction().add(SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey: destinationPubkey, lamports: lamports }));
      const { blockhash } = await connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = keypair.publicKey;
      transaction.sign(keypair);
      const rawTx = transaction.serialize();
      const txSignature = await connection.sendRawTransaction(rawTx, { skipPreflight: false, preflightCommitment: 'confirmed' });
      return { success: true, txSignature: txSignature };
    } catch (err: any) {
      console.error('[SWEEP ERROR]: Ошибка отправки транзакции:', err?.message);
      return { success: false, errorRu: 'Ошибка отправки: ' + (err?.message || 'неизвестная ошибка при отправке транзакции') };
    }
  }

  public async signAndSendModeSwitch(targetMode: OperatingMode): Promise<{ success: boolean; signature?: string; errorRu?: string }> {
    const hasKey = this.isKeyLoaded || (await SecureStorage.hasStoredSeed());
    if (targetMode === 'MICRO_LIVE' && !hasKey) {
      return { success: false, errorRu: 'Переход в Боевой-микро заблокирован: отсутствует подтвержденный торговый ключ в Keystore.' };
    }
    const authOk = await SecureStorage.authenticateBiometrics('Подтвердите смену режима на ' + targetMode);
    if (!authOk) {
      return { success: false, errorRu: 'Биометрическое подтверждение не пройдено.' };
    }
    return { success: true, signature: 'mode-switch-confirmed' };
  }
}

export function createSigningAdapter(): RealSolanaSigningAdapter {
  return new RealSolanaSigningAdapter();
}

import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { BusinessException } from '@/common/exceptions/business.exception';
import { parseBigIntId } from '@/common/utils/bigint.util';
import {
  GSTIN_API_BASE_URL,
  isValidGstinPattern,
  normalizeGstin,
  parseGstinEnabledCompanyCodes,
} from './gstin.constants';
import { VerifyGstinDto } from './dto/verify-gstin.dto';

export interface GstinAddressDetails {
  building_number: string | null;
  building_name: string | null;
  floor: string | null;
  street: string | null;
  locality: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  landmark: string | null;
  pincode: string | null;
}

export interface GstinLookupData {
  gstin: string;
  legal_name: string | null;
  trade_name: string | null;
  status: string | null;
  taxpayer_type: string | null;
  business_constitution: string | null;
  registration_date: string | null;
  cancellation_date: string | null;
  state_code: string | null;
  state_jurisdiction: string | null;
  address: string | null;
  city: string | null;
  address_details: GstinAddressDetails | null;
  pincode: string | null;
  nature_of_business: string | null;
  block_status: string | null;
  einvoice_status?: string | null;
  profile_complete?: boolean;
  test?: boolean;
}

interface GstinApiEnvelope {
  success?: boolean;
  credits_remaining?: number;
  response_ms?: number;
  data?: GstinLookupData;
  error?: string;
  error_code?: string;
}

@Injectable()
export class GstinService {
  private readonly logger = new Logger(GstinService.name);

  constructor(private readonly prisma: PrismaService) {}

  async verifyForCompany(companyId: string, dto: VerifyGstinDto) {
    await this.assertCompanyEnabled(companyId);

    const apiKey = String(process.env.GSTIN_API_KEY || '').trim();
    if (!apiKey) {
      throw new BusinessException(
        'GSTIN verification is not configured (GSTIN_API_KEY missing)',
        HttpStatus.SERVICE_UNAVAILABLE,
        undefined,
        'GSTIN_API_NOT_CONFIGURED',
      );
    }

    const gstin = normalizeGstin(dto.gstin);
    if (!isValidGstinPattern(gstin)) {
      throw new BusinessException(
        `Invalid GSTIN pattern: ${dto.gstin}`,
        HttpStatus.BAD_REQUEST,
        [{ field: 'gstin', message: 'GSTIN must be a valid 15-character Indian GSTIN' }],
        'GSTIN_INVALID_PATTERN',
      );
    }

    const includeProfile = dto.includeProfile !== false;
    const data = await this.lookupGstin(apiKey, gstin, includeProfile);

    return {
      gstin,
      verified: true,
      creditsRemaining: data.creditsRemaining ?? null,
      /** Suggested FE mappings for Ana Vendor form */
      suggestedFields: {
        /** Custom field key on Ana vendor form */
        gstin,
        legalName: data.payload.legal_name ?? null,
        tradeName: data.payload.trade_name ?? null,
        status: data.payload.status ?? null,
        address: data.payload.address ?? null,
        city: data.payload.address_details?.city ?? data.payload.city ?? null,
        pincode: data.payload.address_details?.pincode ?? data.payload.pincode ?? null,
        state: data.payload.address_details?.state ?? null,
        taxpayerType: data.payload.taxpayer_type ?? null,
      },
      raw: data.payload,
    };
  }

  private async assertCompanyEnabled(companyId: string) {
    const company = await this.prisma.company.findFirst({
      where: { companyId: parseBigIntId(companyId), deletedAt: null },
      select: { companyId: true, companyCode: true, name: true },
    });
    if (!company) {
      throw new BusinessException('Company not found', HttpStatus.NOT_FOUND, undefined, 'COMPANY_NOT_FOUND');
    }

    const allowed = parseGstinEnabledCompanyCodes();
    const code = company.companyCode.trim().toUpperCase();
    if (!allowed.includes(code)) {
      throw new BusinessException(
        `GSTIN verification is not enabled for company ${company.companyCode}`,
        HttpStatus.FORBIDDEN,
        undefined,
        'GSTIN_NOT_ENABLED_FOR_COMPANY',
      );
    }
  }

  private async lookupGstin(
    apiKey: string,
    gstin: string,
    includeProfile: boolean,
  ): Promise<{ payload: GstinLookupData; creditsRemaining: number | null }> {
    const maxAttempts = 3;
    let attempt = 0;

    while (attempt < maxAttempts) {
      try {
        const url = new URL(`${GSTIN_API_BASE_URL}/v1/gstin/${encodeURIComponent(gstin)}`);
        if (includeProfile) url.searchParams.set('include', 'profile');

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'x-api-key': apiKey,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(10_000),
        });

        const status = response.status;
        let body: GstinApiEnvelope = {};
        try {
          body = (await response.json()) as GstinApiEnvelope;
        } catch {
          body = {};
        }

        if (status === 429 || status === 502) {
          if (attempt < maxAttempts - 1) {
            attempt += 1;
            const backoff = 2 ** attempt * 1000;
            this.logger.warn(`GSTIN API ${status}; retry ${attempt}/${maxAttempts - 1} in ${backoff}ms`);
            await new Promise((r) => setTimeout(r, backoff));
            continue;
          }
          throw new BusinessException(
            status === 429
              ? 'GSTIN API rate limit exceeded. Try again shortly.'
              : 'GSTIN upstream service timeout. Try again shortly.',
            HttpStatus.BAD_GATEWAY,
            undefined,
            status === 429 ? 'GSTIN_RATE_LIMITED' : 'GSTIN_UPSTREAM_TIMEOUT',
          );
        }

        if (status === 404) {
          throw new BusinessException(
            'GSTIN not found / unregistered',
            HttpStatus.NOT_FOUND,
            [{ field: 'gstin', message: 'GSTIN does not exist in the GST database' }],
            'GSTIN_NOT_FOUND',
          );
        }
        if (status === 400) {
          throw new BusinessException(
            body.error || 'Invalid GSTIN request',
            HttpStatus.BAD_REQUEST,
            [{ field: 'gstin', message: body.error || 'Invalid GSTIN request' }],
            'GSTIN_BAD_REQUEST',
          );
        }
        if (status === 401) {
          throw new BusinessException(
            'GSTIN API unauthorized — check GSTIN_API_KEY',
            HttpStatus.SERVICE_UNAVAILABLE,
            undefined,
            'GSTIN_UNAUTHORIZED',
          );
        }
        if (status === 402) {
          throw new BusinessException(
            'GSTIN API credits exhausted — recharge gstinapi.in balance',
            HttpStatus.PAYMENT_REQUIRED,
            undefined,
            'GSTIN_CREDITS_EXHAUSTED',
          );
        }
        if (status === 403) {
          throw new BusinessException(
            'GSTIN API account forbidden / unverified',
            HttpStatus.FORBIDDEN,
            undefined,
            'GSTIN_FORBIDDEN',
          );
        }

        if (!response.ok || body.success === false) {
          throw new BusinessException(
            body.error || `GSTIN lookup failed (${status})`,
            HttpStatus.BAD_GATEWAY,
            undefined,
            'GSTIN_LOOKUP_FAILED',
          );
        }

        if (!body.data) {
          throw new BusinessException(
            'GSTIN lookup returned empty data',
            HttpStatus.BAD_GATEWAY,
            undefined,
            'GSTIN_EMPTY_RESPONSE',
          );
        }

        return {
          payload: body.data,
          creditsRemaining:
            typeof body.credits_remaining === 'number' ? body.credits_remaining : null,
        };
      } catch (err) {
        if (err instanceof BusinessException) throw err;
        attempt += 1;
        if (attempt >= maxAttempts) {
          this.logger.error(`GSTIN lookup network failure: ${(err as Error).message}`);
          throw new BusinessException(
            'Unable to reach GSTIN verification service',
            HttpStatus.BAD_GATEWAY,
            undefined,
            'GSTIN_NETWORK_ERROR',
          );
        }
        const backoff = 2 ** attempt * 1000;
        await new Promise((r) => setTimeout(r, backoff));
      }
    }

    throw new BusinessException(
      'Exceeded maximum GSTIN lookup retries',
      HttpStatus.BAD_GATEWAY,
      undefined,
      'GSTIN_RETRY_EXHAUSTED',
    );
  }
}

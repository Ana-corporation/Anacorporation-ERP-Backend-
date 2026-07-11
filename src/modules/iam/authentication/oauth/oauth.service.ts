import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@/common/exceptions/business.exception';
import { AuthService, AuthClientMeta } from '../auth.service';
import { AuthRepository } from '../auth.repository';

type OAuthProviderKey = 'google' | 'microsoft';

interface OAuthStatePayload {
  provider: OAuthProviderKey;
  companyCode: string;
  redirectUri: string;
}

interface OAuthProfile {
  providerUserId: string;
  email: string;
  displayName?: string;
}

@Injectable()
export class OAuthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
    private readonly authRepository: AuthRepository,
  ) {}

  getAuthorizationUrl(provider: OAuthProviderKey, companyCode: string, redirectUri: string) {
    this.assertProviderConfigured(provider);

    const state = this.jwtService.sign(
      { provider, companyCode, redirectUri } satisfies OAuthStatePayload,
      { expiresIn: '10m' },
    );

    const params = new URLSearchParams();
    params.set('client_id', this.getClientId(provider)!);
    params.set('redirect_uri', redirectUri);
    params.set('response_type', 'code');
    params.set('scope', this.getScopes(provider));
    params.set('state', state);
    if (provider === 'microsoft') {
      params.set('response_mode', 'query');
    }
    if (provider === 'google') {
      params.set('access_type', 'offline');
      params.set('prompt', 'consent');
    }

    return {
      authorizationUrl: `${this.getAuthorizeEndpoint(provider)}?${params.toString()}`,
      state,
    };
  }

  async handleCallback(
    provider: OAuthProviderKey,
    code: string,
    state: string,
    meta: AuthClientMeta = {},
  ) {
    const statePayload = this.verifyState(state);
    if (statePayload.provider !== provider) {
      throw new BadRequestException('OAuth provider mismatch');
    }

    const profile = await this.exchangeCodeForProfile(
      provider,
      code,
      statePayload.redirectUri,
    );

    const company = await this.authService.resolveCompanyForLogin(
      undefined,
      statePayload.companyCode,
    );
    const companyId = company.companyId.toString();

    let userId: string | null = null;

    const linked = await this.authRepository.findOAuthIdentity(provider, profile.providerUserId);
    if (linked) {
      userId = linked.userId.toString();
    } else {
      const membership = await this.authRepository.findMembershipByEmail(
        companyId,
        profile.email,
      );
      if (!membership) {
        throw new UnauthorizedException(
          'No ERP account found for this email in the selected company. Contact your administrator.',
        );
      }
      userId = membership.user.userId.toString();
      await this.authRepository.upsertOAuthIdentity({
        userId,
        provider,
        providerUserId: profile.providerUserId,
        email: profile.email,
        displayName: profile.displayName,
      });
    }

    return this.authService.loginOAuthUser(userId, companyId, meta);
  }

  async exchangeCode(
    provider: OAuthProviderKey,
    code: string,
    companyCode: string,
    redirectUri: string,
    meta: AuthClientMeta = {},
  ) {
    const profile = await this.exchangeCodeForProfile(provider, code, redirectUri);
    const company = await this.authService.resolveCompanyForLogin(undefined, companyCode);
    const companyId = company.companyId.toString();

    const linked = await this.authRepository.findOAuthIdentity(provider, profile.providerUserId);
    let userId = linked?.userId.toString();

    if (!userId) {
      const membership = await this.authRepository.findMembershipByEmail(
        companyId,
        profile.email,
      );
      if (!membership) {
        throw new UnauthorizedException(
          'No ERP account found for this email in the selected company',
        );
      }
      userId = membership.user.userId.toString();
      await this.authRepository.upsertOAuthIdentity({
        userId,
        provider,
        providerUserId: profile.providerUserId,
        email: profile.email,
        displayName: profile.displayName,
      });
    }

    return this.authService.loginOAuthUser(userId, companyId, meta);
  }

  private verifyState(state: string): OAuthStatePayload {
    try {
      return this.jwtService.verify<OAuthStatePayload>(state);
    } catch {
      throw new BadRequestException('Invalid or expired OAuth state');
    }
  }

  private async exchangeCodeForProfile(
    provider: OAuthProviderKey,
    code: string,
    redirectUri: string,
  ): Promise<OAuthProfile> {
    this.assertProviderConfigured(provider);

    const body = new URLSearchParams();
    body.set('client_id', this.getClientId(provider)!);
    body.set('client_secret', this.getClientSecret(provider)!);
    body.set('code', code);
    body.set('redirect_uri', redirectUri);
    body.set('grant_type', 'authorization_code');

    const tokenResponse = await fetch(this.getTokenEndpoint(provider), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!tokenResponse.ok) {
      throw new UnauthorizedException('OAuth token exchange failed');
    }

    const tokenJson = (await tokenResponse.json()) as { access_token?: string };
    if (!tokenJson.access_token) {
      throw new UnauthorizedException('OAuth token missing');
    }

    const profileResponse = await fetch(this.getProfileEndpoint(provider), {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });

    if (!profileResponse.ok) {
      throw new UnauthorizedException('OAuth profile fetch failed');
    }

    const profileJson = await profileResponse.json();
    return this.normalizeProfile(provider, profileJson);
  }

  private normalizeProfile(provider: OAuthProviderKey, json: Record<string, unknown>): OAuthProfile {
    if (provider === 'google') {
      const email = String(json.email ?? '');
      if (!email) throw new UnauthorizedException('Google account email not available');
      return {
        providerUserId: String(json.sub),
        email: email.toLowerCase(),
        displayName: json.name ? String(json.name) : undefined,
      };
    }

    const email = String(json.mail ?? json.userPrincipalName ?? '');
    if (!email) throw new UnauthorizedException('Microsoft account email not available');
    return {
      providerUserId: String(json.id),
      email: email.toLowerCase(),
      displayName: json.displayName ? String(json.displayName) : undefined,
    };
  }

  private assertProviderConfigured(provider: OAuthProviderKey) {
    if (!this.getClientId(provider) || !this.getClientSecret(provider)) {
      throw new BadRequestException(`${provider} OAuth is not configured on this server`);
    }
  }

  private getClientId(provider: OAuthProviderKey) {
    return provider === 'google'
      ? this.configService.get<string>('oauth.google.clientId')
      : this.configService.get<string>('oauth.microsoft.clientId');
  }

  private getClientSecret(provider: OAuthProviderKey) {
    return provider === 'google'
      ? this.configService.get<string>('oauth.google.clientSecret')
      : this.configService.get<string>('oauth.microsoft.clientSecret');
  }

  private getAuthorizeEndpoint(provider: OAuthProviderKey) {
    return provider === 'google'
      ? 'https://accounts.google.com/o/oauth2/v2/auth'
      : `https://login.microsoftonline.com/${this.configService.get<string>('oauth.microsoft.tenantId') ?? 'common'}/oauth2/v2.0/authorize`;
  }

  private getTokenEndpoint(provider: OAuthProviderKey) {
    return provider === 'google'
      ? 'https://oauth2.googleapis.com/token'
      : `https://login.microsoftonline.com/${this.configService.get<string>('oauth.microsoft.tenantId') ?? 'common'}/oauth2/v2.0/token`;
  }

  private getProfileEndpoint(provider: OAuthProviderKey) {
    return provider === 'google'
      ? 'https://www.googleapis.com/oauth2/v3/userinfo'
      : 'https://graph.microsoft.com/v1.0/me';
  }

  private getScopes(provider: OAuthProviderKey) {
    return provider === 'google'
      ? 'openid email profile'
      : 'openid email profile User.Read';
  }
}

import { Injectable, inject, signal } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';

interface AuthSettings {
  authority: string;
  clientId: string;
  domain: string;
}
interface AppConfig {
  auth: AuthSettings | null;
}

@Injectable({ providedIn: 'root' })
export class Auth {
  readonly enabled = signal(true);
  readonly authenticated = signal(false);
  readonly email = signal<string | null>(null);
  readonly error = signal('');
  private manager: UserManager | null = null;
  private config: AppConfig | null = null;
  private loading: Promise<void> | null = null;
  private invalidated = false;

  ready(): Promise<void> {
    this.loading ??= this.load().catch((error: unknown) => {
      this.error.set(
        error instanceof Error
          ? error.message
          : 'Authentication configuration could not be loaded.',
      );
      throw error;
    });
    return this.loading;
  }

  async retry(): Promise<void> {
    this.loading = null;
    this.error.set('');
    await this.ready();
  }

  async login(): Promise<void> {
    await this.ready();
    if (!this.manager) return;
    await this.manager.removeUser();
    await this.manager.signinRedirect();
  }

  async handleCallback(): Promise<void> {
    await this.ready();
    if (!this.manager) throw new Error('Sign-in is not configured for this environment.');
    const user = await this.manager.signinRedirectCallback();
    this.invalidated = false;
    this.setUser(user);
  }

  async token(): Promise<string | null> {
    await this.ready();
    if (this.invalidated) return null;
    if (!this.manager) return null;
    let user = await this.manager.getUser();
    if (user?.expired) {
      try {
        user = await this.manager.signinSilent();
      } catch {
        this.setUser(null);
        return null;
      }
    }
    this.setUser(user);
    return user && !user.expired ? user.access_token : null;
  }

  expire(): void {
    this.invalidated = true;
    this.setUser(null);
  }

  async signOut(): Promise<void> {
    await this.ready();
    await this.manager?.removeUser();
    this.setUser(null);
    const auth = this.config?.auth;
    if (!auth) return;
    const logout = new URL('/logout', auth.domain);
    logout.searchParams.set('client_id', auth.clientId);
    logout.searchParams.set('logout_uri', `${location.origin}/`);
    location.assign(logout.toString());
  }

  private setUser(user: User | null): void {
    this.authenticated.set(!!user && !user.expired && !this.invalidated);
    const username = user?.profile['cognito:username'];
    this.email.set(
      user && !user.expired && !this.invalidated
        ? (user.profile.email ?? (typeof username === 'string' ? username : null))
        : null,
    );
  }

  private async load(): Promise<void> {
    const response = await fetch('/config.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Unable to load sign-in configuration. Reload or try again.');
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object' || !('auth' in value)) {
      throw new Error('Invalid sign-in configuration. Access has been stopped for your safety.');
    }
    const auth = (value as AppConfig).auth;
    if (
      auth !== null &&
      (!auth ||
        typeof auth.authority !== 'string' ||
        typeof auth.clientId !== 'string' ||
        typeof auth.domain !== 'string' ||
        !auth.authority ||
        !auth.clientId ||
        !auth.domain)
    ) {
      throw new Error('Incomplete sign-in configuration. Access has been stopped for your safety.');
    }
    this.config = { auth };
    if (auth === null) {
      this.enabled.set(false);
      this.authenticated.set(true);
      return;
    }
    this.enabled.set(true);
    this.manager = new UserManager({
      authority: auth.authority,
      client_id: auth.clientId,
      redirect_uri: `${location.origin}/auth/callback`,
      post_logout_redirect_uri: `${location.origin}/`,
      response_type: 'code',
      scope: 'openid email profile',
      automaticSilentRenew: true,
      userStore: new WebStorageStateStore({ store: localStorage }),
    });
    this.manager.events.addUserLoaded((user) => this.setUser(user));
    this.manager.events.addUserUnloaded(() => this.setUser(null));
    this.manager.events.addAccessTokenExpired(() => this.setUser(null));
    this.setUser(await this.manager.getUser());
  }
}

export const authGuard: CanActivateFn = async () => {
  const auth = inject(Auth);
  try {
    await auth.ready();
    if (!auth.enabled() || (await auth.token())) return true;
    await auth.login();
  } catch (error) {
    auth.error.set(error instanceof Error ? error.message : 'Unable to open secure sign-in.');
  }
  return false;
};

import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Auth } from '../core/auth';
import { errorMessage } from '../core/api';

@Component({
  selector: 'app-sign-in',
  standalone: true,
  template: `
    <section class="auth-layout">
      <div class="auth-story">
        <p class="eyebrow">A little practice. A richer vocabulary.</p>
        <h1>Make the words<br />you find your own.</h1>
        <p class="lede">
          Keep meaningful sentences, uncover the nuances, and return to each word just when you need
          to.
        </p>
        <div class="auth-rule"></div>
        <p class="muted">Your words. Your context. Your private learning space.</p>
      </div>
      <div class="panel auth-panel">
        <span class="brand-mark" aria-hidden="true">b.</span>
        <h2>Welcome to Beehappy</h2>
        <p class="muted">Sign in to open your vocabulary.</p>
        @if (loading()) {
          <p class="loading" role="status">Preparing your learning space…</p>
        }
        @if (error() || auth.error()) {
          <div class="notice error" role="alert">{{ error() || auth.error() }}</div>
        }
        @if (!loading()) {
          @if (auth.error()) {
            <button class="button primary full" (click)="retry()">Retry configuration</button>
          } @else {
            <button class="button primary full" (click)="signIn()" [disabled]="busy()">
              {{ busy() ? 'Opening secure sign-in…' : 'Sign in securely' }}
            </button>
          }
        }
        <p class="small muted">Access is by invitation. Self-registration is not available.</p>
      </div>
    </section>
  `,
})
export class SignInPage implements OnInit {
  readonly auth = inject(Auth);
  private readonly router = inject(Router);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');

  async ngOnInit(): Promise<void> {
    try {
      await this.auth.ready();
      if (!this.auth.enabled() || (await this.auth.token()))
        await this.router.navigate(['/vocabulary']);
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  async retry(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      await this.auth.retry();
      await this.ngOnInit();
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  async signIn(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.login();
    } catch (error) {
      this.error.set(errorMessage(error));
      this.busy.set(false);
    }
  }
}

@Component({
  selector: 'app-auth-callback',
  standalone: true,
  imports: [RouterLink],
  template: `<section class="centered panel">
    <p class="eyebrow">Beehappy</p>
    <h1>{{ error() ? 'Sign-in needs another try' : 'Making you at home…' }}</h1>
    @if (error()) {
      <p role="alert" class="notice error">{{ error() }}</p>
      <a routerLink="/sign-in" class="button primary">Return to sign-in</a>
    } @else {
      <p class="muted" role="status">Completing secure sign-in.</p>
    }
  </section>`,
})
export class AuthCallbackPage implements OnInit {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  readonly error = signal('');
  async ngOnInit(): Promise<void> {
    try {
      await this.auth.handleCallback();
      await this.router.navigate(['/vocabulary'], { replaceUrl: true });
    } catch (error) {
      this.error.set(errorMessage(error));
    }
  }
}

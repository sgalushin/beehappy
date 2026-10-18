import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Auth } from './core/auth';
import { errorMessage } from './core/api';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <a class="skip-link" href="#main-content">Skip to content</a>
    <div class="library">
      @if (auth.authenticated()) {
        <header class="library-head">
          <a routerLink="/vocabulary" class="brand" aria-label="Beehappy home">
            <span class="brand-mark" aria-hidden="true">b.</span>
            <span>Bee<span class="sage-text">happy</span></span>
          </a>
          <nav class="library-actions" aria-label="Main navigation">
            <a
              routerLink="/vocabulary"
              routerLinkActive="active"
              ariaCurrentWhenActive="page"
              aria-label="Vocabulary"
            >
              <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 4h16v16H4zM8 8h8M8 12h8M8 16h5" />
              </svg>
              <span>Vocabulary</span>
            </a>
            <a
              routerLink="/review"
              routerLinkActive="active"
              ariaCurrentWhenActive="page"
              aria-label="Review"
            >
              <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m8 5 11 7-11 7z" />
              </svg>
              <span>Review</span>
            </a>
            <a
              routerLink="/progress"
              routerLinkActive="active"
              ariaCurrentWhenActive="page"
              aria-label="Progress"
            >
              <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 3v17h17M9 16v-5M14 16V7M19 16V4" />
              </svg>
              <span>Progress</span>
            </a>
          </nav>
          @if (auth.enabled()) {
            <div class="account-actions">
              <span class="account-email" [title]="auth.email() || ''">{{ auth.email() }}</span>
              <button class="button sign-out" (click)="signOut()" [disabled]="signingOut()">
                Sign out
              </button>
            </div>
          }
        </header>
      }
      @if (error()) {
        <div class="notice error" role="alert">{{ error() }}</div>
      }
      @if (auth.error() && !router.url.startsWith('/auth/callback')) {
        <section class="panel auth-status">
          <h1>Unable to sign in</h1>
          <p role="alert">{{ auth.error() }}</p>
          <button class="button primary" (click)="retrySignIn()">Retry sign-in</button>
        </section>
      }
      <main id="main-content" tabindex="-1">
        <router-outlet />
      </main>
    </div>
  `,
})
export class App {
  readonly auth = inject(Auth);
  readonly router = inject(Router);
  readonly error = signal('');
  readonly signingOut = signal(false);
  async signOut(): Promise<void> {
    if (this.signingOut()) return;
    this.signingOut.set(true);
    this.error.set('');
    try {
      await this.auth.signOut();
    } catch (error) {
      this.error.set(errorMessage(error));
      this.signingOut.set(false);
    }
  }

  async retrySignIn(): Promise<void> {
    try {
      await this.auth.retry();
      await this.auth.login();
    } catch (error) {
      this.auth.error.set(errorMessage(error));
    }
  }
}

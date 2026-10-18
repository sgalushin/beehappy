import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Auth } from '../core/auth';
import { errorMessage } from '../core/api';

@Component({
  selector: 'app-auth-callback',
  standalone: true,
  template: `<section class="auth-status panel">
    <h1>{{ error() ? 'Sign-in failed' : 'Signing in…' }}</h1>
    @if (error()) {
      <p role="alert" class="notice error">{{ error() }}</p>
      <button class="button primary" (click)="retry()">Retry sign-in</button>
    } @else {
      <p role="status">Completing secure sign-in.</p>
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

  async retry(): Promise<void> {
    this.error.set('');
    try {
      await this.auth.retry();
      await this.auth.login();
    } catch (error) {
      this.error.set(errorMessage(error));
    }
  }
}

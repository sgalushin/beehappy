import { Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Auth } from './core/auth';
import { errorMessage } from './core/api';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <a class="skip-link" href="#main-content">Skip to content</a>
    @if (auth.authenticated()) {
      <aside class="sidebar">
        <a routerLink="/vocabulary" class="brand" aria-label="Beehappy home"
          ><span class="brand-mark" aria-hidden="true">b.</span
          ><span>Beehappy<span class="brand-caption">Words worth keeping</span></span></a
        >
        <div class="nav-caption">Your learning space</div>
        <nav class="main-nav" aria-label="Main navigation">
          <a routerLink="/vocabulary" routerLinkActive="active" ariaCurrentWhenActive="page"
            ><span class="nav-number" aria-hidden="true">01</span>Vocabulary<span
              class="nav-arrow"
              aria-hidden="true"
              >↗</span
            ></a
          ><a routerLink="/review" routerLinkActive="active" ariaCurrentWhenActive="page"
            ><span class="nav-number" aria-hidden="true">02</span>Review<span
              class="nav-arrow"
              aria-hidden="true"
              >↗</span
            ></a
          ><a routerLink="/progress" routerLinkActive="active" ariaCurrentWhenActive="page"
            ><span class="nav-number" aria-hidden="true">03</span>Progress<span
              class="nav-arrow"
              aria-hidden="true"
              >↗</span
            ></a
          >
        </nav>
        <div class="sidebar-note">
          <span class="note-line"></span>
          <p>A word today.<br />A world of difference.</p>
        </div>
        <div class="account">
          <span class="account-avatar" aria-hidden="true">{{
            auth.email()?.slice(0, 1)?.toUpperCase() || 'B'
          }}</span>
          <div>
            <span class="account-label">{{
              auth.enabled() ? auth.email() || 'Your account' : 'Local workspace'
            }}</span
            ><span class="small muted">Private vocabulary</span>
          </div>
          @if (auth.enabled()) {
            <button
              class="icon-button signout-button"
              (click)="signOut()"
              [disabled]="signingOut()"
              aria-label="Sign out"
              title="Sign out"
            >
              ↪
            </button>
          }
        </div>
      </aside>
    } @else {
      <header class="public-header">
        <a routerLink="/" class="brand"
          ><span class="brand-mark" aria-hidden="true">b.</span>Beehappy</a
        ><span class="small muted">Words worth keeping.</span>
      </header>
    }
    <div [class.workspace]="auth.authenticated()" [class.public-content]="!auth.authenticated()">
      @if (auth.authenticated()) {
        <header class="workspace-topbar">
          <span
            >English vocabulary <span class="topbar-divider">/</span> A practice of noticing</span
          ><span class="private-label"
            ><i class="status-dot review" aria-hidden="true"></i> A space of your own</span
          >
        </header>
      }
      @if (error()) {
        <div class="notice error shell-error" role="alert">{{ error() }}</div>
      }
      <main id="main-content" tabindex="-1" [class.main-content]="auth.authenticated()">
        <router-outlet />
      </main>
      @if (auth.authenticated()) {
        <footer class="workspace-footer">
          <span>Beehappy</span><span>One meaningful encounter at a time.</span>
        </footer>
      }
    </div>
  `,
})
export class App {
  readonly auth = inject(Auth);
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
}

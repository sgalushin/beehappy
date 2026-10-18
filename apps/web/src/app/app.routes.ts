import { Component } from '@angular/core';
import { RouterLink, type Routes } from '@angular/router';
import { authGuard } from './core/auth';
import { AuthCallbackPage, SignInPage } from './pages/sign-in';
import { VocabularyPage } from './pages/vocabulary';
import { WordEditorPage } from './pages/word-editor';
import { WordDetailPage } from './pages/word-detail';
import { ReviewPage } from './pages/review';
import { ProgressPage } from './pages/progress';

@Component({
  selector: 'app-not-found',
  standalone: true,
  imports: [RouterLink],
  template: `<section class="panel empty">
    <p class="eyebrow">A small detour</p>
    <h1>This page isn’t in your collection.</h1>
    <p>Let’s get you back to your words.</p>
    <a routerLink="/vocabulary" class="button primary">Open vocabulary</a>
  </section>`,
})
class NotFoundPage {}

export const appRoutes: Routes = [
  { path: '', redirectTo: 'vocabulary', pathMatch: 'full' },
  { path: 'sign-in', component: SignInPage },
  { path: 'auth/callback', component: AuthCallbackPage },
  { path: 'vocabulary', component: VocabularyPage, canActivate: [authGuard] },
  {
    path: 'vocabulary/new',
    component: WordEditorPage,
    canActivate: [authGuard],
    canDeactivate: [(component: WordEditorPage) => component.canLeave()],
  },
  {
    path: 'vocabulary/:id/edit',
    component: WordEditorPage,
    canActivate: [authGuard],
    canDeactivate: [(component: WordEditorPage) => component.canLeave()],
  },
  { path: 'vocabulary/:id', component: WordDetailPage, canActivate: [authGuard] },
  { path: 'review', component: ReviewPage, canActivate: [authGuard] },
  { path: 'progress', component: ProgressPage, canActivate: [authGuard] },
  { path: '**', component: NotFoundPage },
];

import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { Auth } from './auth';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith('/api/')) return next(request);
  const auth = inject(Auth);
  const router = inject(Router);
  return from(auth.token()).pipe(
    switchMap((token) => {
      if (auth.enabled() && !token) {
        return throwError(
          () =>
            new HttpErrorResponse({
              status: 401,
              error: { error: 'Your session has ended. Sign in to continue.' },
            }),
        );
      }
      return next(
        token ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : request,
      );
    }),
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401 && auth.enabled()) {
        auth.expire();
        void router.navigate(['/sign-in']);
      }
      return throwError(() => error);
    }),
  );
};

import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { appConfig } from './app/app.config';

bootstrapApplication(App, appConfig).catch((error: unknown) => {
  console.error('Beehappy could not start', error);
  const message = document.createElement('p');
  message.textContent = 'Beehappy could not start. Please reload this page.';
  document.body.replaceChildren(message);
});
